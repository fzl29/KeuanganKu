import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const url = 'https://lripvlmhvqoljhehoyjo.supabase.co';
const key = 'sb_publishable_R98-GU_FmhFYEzn0EEwezg_9DscOQWc';
const syncCode = 'Republik1429';

const supabase = createClient(url, key);

async function main() {
  console.log("Fetching state from Supabase...");
  const { data, error } = await supabase
    .from('keuanganku_sync')
    .select('state_data')
    .eq('sync_code', syncCode)
    .maybeSingle();

  if (error || !data) {
    console.error("Error fetching state:", error);
    return;
  }

  const state = data.state_data;
  const token = state.telegram?.token;
  const chatId = state.telegram?.chatId;

  if (!token || !chatId) {
    console.error("Token or Chat ID not found in Supabase state.");
    return;
  }

  console.log("Found Token and Chat ID. Registering Webhook...");

  const edgeUrl = encodeURIComponent(`https://lripvlmhvqoljhehoyjo.supabase.co/functions/v1/telegram-bot?bot_token=${token}&chat_id=${chatId}&sync_code=${syncCode}`);
  
  const webhookRes = await fetch(`https://api.telegram.org/bot${token}/setWebhook?url=${edgeUrl}`);
  const webhookData = await webhookRes.json();
  
  if (webhookData.ok) {
    console.log("✅ Webhook SUCCESSFULLY registered directly to Telegram!");
    
    // Also send a test message to prove it works
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: "⚡ <b>System Override: Server 24/7 Terhubung!</b>\n\nWebhook berhasil didaftarkan ulang secara paksa. Anda sekarang bisa menggunakan <code>/laporan</code>.",
        parse_mode: 'HTML'
      })
    });
    console.log("Test message sent.");
  } else {
    console.error("Failed to set webhook:", webhookData.description);
  }
}

main();
