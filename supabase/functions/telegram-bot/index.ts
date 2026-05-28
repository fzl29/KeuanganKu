import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  try {
    const url = new URL(req.url)
    const botToken = url.searchParams.get('bot_token')
    const allowedChatId = url.searchParams.get('chat_id')
    const syncCode = url.searchParams.get('sync_code')

    if (!botToken || !allowedChatId || !syncCode) {
      return new Response('Missing configuration parameters', { status: 400 })
    }

    // Hanya merespons request POST dari Telegram
    if (req.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 })
    }

    const body = await req.json()
    const message = body.message || body.edited_message

    if (!message || !message.text) {
      return new Response('OK', { status: 200 })
    }

    // Keamanan: Tolak jika Chat ID tidak sama dengan milik Anda
    if (String(message.chat.id) !== allowedChatId) {
      return new Response('Unauthorized chat', { status: 403 })
    }

    const text = message.text.trim()
    const lowerText = text.toLowerCase()

    // Supabase Setup
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Helper kirim pesan ke Telegram
    const reply = async (msg: string) => {
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: allowedChatId,
          text: msg,
          parse_mode: 'HTML'
        })
      })
    }

    // Format Rupiah
    const rp = (num: number) => 'Rp ' + num.toLocaleString('id-ID')

    // Handle Input Transaksi 
    // Format: "+ 50000 Gaji" atau "- 25000 Makan"
    if (text.startsWith('+') || text.startsWith('-') || text.startsWith('/catat')) {
      // Parse isi
      let commandText = text
      if (text.startsWith('/catat')) {
        commandText = text.replace('/catat', '').trim()
      }
      
      const parts = commandText.split(' ')
      const typeStr = parts[0] // "+" atau "-"
      
      // Jika salah format
      if ((typeStr !== '+' && typeStr !== '-') || parts.length < 2) {
         await reply('❌ Format salah! Gunakan format:\n<code>+ 50000 Gaji</code>\natau\n<code>- 20000 Makan</code>')
         return new Response('OK')
      }

      const amountStr = parts[1].replace(/[^0-9]/g, '')
      const desc = parts.slice(2).join(' ').trim() || 'Input dari Telegram'

      if (!amountStr || isNaN(Number(amountStr))) {
        await reply('❌ Nominal harus berupa angka yang valid.')
        return new Response('OK')
      }

      const amount = Number(amountStr)
      const type = typeStr === '+' ? 'income' : 'expense'
      const category = type === 'income' ? 'Pemasukan Lain' : 'Lain-lain'
      const newTransaction = {
        id: 'tx-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
        type,
        amount,
        desc,
        cat: category,
        date: new Date().toISOString()
      }

      // 1. Ambil state lama dari Supabase
      const { data, error: fetchError } = await supabase
        .from('keuanganku_sync')
        .select('state_data')
        .eq('sync_code', syncCode)
        .maybeSingle()

      if (fetchError || !data || !data.state_data) {
        await reply(`❌ Gagal mengambil data Cloud. Pastikan kode sync "${syncCode}" benar dan pernah disinkronisasi dari web minimal satu kali.`)
        return new Response('OK')
      }

      const currentState = data.state_data

      // 2. Tambahkan transaksi baru ke array
      if (!currentState.transactions) {
         currentState.transactions = []
      }
      // Insert at the beginning (newest first)
      currentState.transactions.unshift(newTransaction)

      // 3. Simpan kembali ke Supabase
      const payload = {
        sync_code: syncCode,
        state_data: currentState,
        updated_at: new Date().toISOString()
      }

      const { error: upsertError } = await supabase
        .from('keuanganku_sync')
        .upsert(payload, { onConflict: 'sync_code' })

      if (upsertError) {
        await reply(`❌ Gagal menyimpan transaksi ke Cloud: ${upsertError.message}`)
      } else {
        await reply(`✅ <b>Transaksi Berhasil Dicatat (Cloud Sync)!</b>\n\nJenis: ${type === 'income' ? '🟢 Pemasukan' : '🔴 Pengeluaran'}\nNominal: <b>${rp(amount)}</b>\nKeterangan: <i>${desc}</i>\n\n<i>Buka web KeuanganKu untuk melihat update secara real-time.</i>`)
      }
      return new Response('OK')
    }

    // Handle Perintah /laporan
    if (lowerText === '/laporan' || lowerText === 'laporan' || lowerText === '/status') {
       // Ambil data terbaru dari cloud
       const { data } = await supabase
        .from('keuanganku_sync')
        .select('state_data')
        .eq('sync_code', syncCode)
        .maybeSingle()
        
       if (!data || !data.state_data) {
         await reply('❌ Data cloud tidak ditemukan. Harap sinkronisasi dari web terlebih dahulu.')
         return new Response('OK')
       }
       
       const state = data.state_data
       let income = 0; let expense = 0;
       (state.transactions || []).forEach((t: any) => {
         if (t.type === 'income') income += Number(t.amount);
         if (t.type === 'expense') expense += Number(t.amount);
       })
       const saldo = income - expense;
       
       let reportText = `📊 <b>LAPORAN CLOUD KEUANGANKU</b>\n\n` +
                        `🟢 Pemasukan: <code>${rp(income)}</code>\n` +
                        `🔴 Pengeluaran: <code>${rp(expense)}</code>\n` +
                        `💳 <b>Sisa Saldo:</b> <code>${rp(saldo)}</code>\n\n` +
                        `<i>Data live 24/7 dari Server Supabase</i>`;
       await reply(reportText);
       return new Response('OK')
    }

    // Default response (Help)
    if (lowerText === '/start' || lowerText === '/help' || lowerText === 'menu') {
      await reply('👋 <b>Halo! Server Bot KeuanganKu 24/7 Aktif!</b>\n\nKini Anda bisa langsung mencatat transaksi tanpa buka web:\n\nCatat Pemasukan:\n<code>+ 50000 Gaji bulanan</code>\n\nCatat Pengeluaran:\n<code>- 25000 Beli Kopi</code>\n\nLihat Saldo:\n<code>/laporan</code>')
    }

    return new Response('OK')
  } catch (err) {
    console.error(err)
    return new Response('Internal Server Error', { status: 500 })
  }
})
