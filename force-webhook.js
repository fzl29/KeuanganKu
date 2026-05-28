const url = 'https://lripvlmhvqoljhehoyjo.supabase.co/rest/v1/keuanganku_sync?select=state_data&sync_code=eq.Republik1429';
const key = 'sb_publishable_R98-GU_FmhFYEzn0EEwezg_9DscOQWc';

async function main() {
  console.log("Fetching state from Supabase API...");
  const res = await fetch(url, {
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`
    }
  });

  const data = await res.json();
  if (!data || data.length === 0) {
    console.error("Error fetching state or not found.");
    return;
  }

  const state = data[0].state_data;
  const token = state.telegram?.token;
  const chatId = state.telegram?.chatId;

  if (!token || !chatId) {
    console.error("Token or Chat ID not found in Supabase state.");
    return;
  }

  console.log("Found Token and Chat ID. Registering Webhook...");

  const edgeUrl = encodeURIComponent(`https://lripvlmhvqoljhehoyjo.supabase.co/functions/v1/telegram-bot?bot_token=${token}&chat_id=${chatId}&sync_code=Republik1429`);
  
  const webhookRes = await fetch(`https://api.telegram.org/bot${token}/setWebhook?url=${edgeUrl}`);
  const webhookData = await webhookRes.json();
  
  if (webhookData.ok) {
    console.log("✅ Webhook SUCCESSFULLY registered directly to Telegram!");
    
    // Also send a test message
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
