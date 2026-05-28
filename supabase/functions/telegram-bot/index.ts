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

    // Handle Perintah Menabung (Bisa tanpa slash)
    if (lowerText.startsWith('/tabung') || lowerText.startsWith('tabung') || lowerText.startsWith('nabung') || lowerText.startsWith('simpan')) {
      const parts = text.split(' ')
      if (parts.length < 2) {
        await reply('❌ Kurang lengkap! Kasih tahu nominalnya ya.\nContoh: <code>nabung 50000</code> atau <code>nabung 50000 laptop</code>')
        return new Response('OK')
      }
      
      const amountStr = parts[1].replace(/[^0-9]/g, '')
      if (!amountStr || isNaN(Number(amountStr))) {
        await reply('❌ Nominal uangnya harus berupa angka ya.')
        return new Response('OK')
      }
      const amount = Number(amountStr)
      const targetName = parts.slice(2).join(' ').trim().toLowerCase()

      const { data, error: fetchError } = await supabase
        .from('keuanganku_sync')
        .select('state_data')
        .eq('sync_code', syncCode)
        .maybeSingle()

      if (fetchError || !data || !data.state_data) {
        await reply(`❌ Gagal mengambil data Cloud. Pastikan Anda telah melakukan sinkronisasi minimal satu kali di web.`)
        return new Response('OK')
      }

      const currentState = data.state_data
      if (!currentState.savings || currentState.savings.length === 0) {
        await reply('❌ Anda belum memiliki celengan/tabungan. Silakan buat celengan baru di aplikasi web terlebih dahulu.')
        return new Response('OK')
      }

      let targetIdx = 0 // default ke celengan pertama
      if (targetName) {
        const foundIdx = currentState.savings.findIndex((s: any) => s.nama.toLowerCase().includes(targetName))
        if (foundIdx !== -1) {
          targetIdx = foundIdx
        } else {
          await reply(`❌ Celengan dengan nama yang mengandung kata "${targetName}" tidak ditemukan.\nCelengan Anda yang tersedia:\n` + currentState.savings.map((s:any) => `- ${s.nama}`).join('\n'))
          return new Response('OK')
        }
      }

      currentState.savings[targetIdx].terkumpul += amount
      
      const payload = {
        sync_code: syncCode,
        state_data: currentState,
        updated_at: new Date().toISOString()
      }
      
      const { error: upsertError } = await supabase
        .from('keuanganku_sync')
        .upsert(payload, { onConflict: 'sync_code' })

      if (upsertError) {
        await reply(`❌ Waduh, gagal menyimpan tabungan ke Cloud: ${upsertError.message}`)
      } else {
        const s = currentState.savings[targetIdx]
        const pct = Math.min(Math.round((s.terkumpul / s.target) * 100), 100)
        await reply(`✅ <b>Asyik, Berhasil Nabung!</b>\n\n🐷 Celengan: <b>${s.nama}</b>\n➕ Masuk: <b>${rp(amount)}</b>\n\n📊 Terkumpul: <b>${rp(s.terkumpul)}</b> / ${rp(s.target)} (${pct}%)`)
      }
      return new Response('OK')
    }

    // Handle Perintah laporan (Bisa tanpa slash)
    if (lowerText === '/laporan' || lowerText === 'laporan' || lowerText === '/status' || lowerText === 'saldo' || lowerText === 'cek saldo') {
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
    if (lowerText === '/start' || lowerText === '/help' || lowerText === 'halo' || lowerText === 'hi' || lowerText === 'menu') {
      await reply('👋 <b>Halo! Saya asisten KeuanganKu Anda!</b>\n\nSilakan ngobrol santai untuk mencatat transaksi:\n\n🟢 <b>Pemasukan:</b>\n<code>+ 50000 Gaji bulanan</code>\n\n🔴 <b>Pengeluaran:</b>\n<code>- 25000 Beli Kopi</code>\n\n🐷 <b>Isi Celengan:</b>\n<code>nabung 20000 laptop</code>\n\n📊 <b>Cek Saldo:</b>\nKetik saja <code>laporan</code> atau <code>saldo</code>')
    }

    return new Response('OK')
  } catch (err) {
    console.error(err)
    return new Response('Internal Server Error', { status: 500 })
  }
})
