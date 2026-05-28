const url = "https://lripvlmhvqoljhehoyjo.supabase.co/functions/v1/telegram-bot?bot_token=dummy_token&chat_id=12345&sync_code=Republik1429";

const payload = {
  update_id: 10000,
  message: {
    message_id: 1,
    from: {
      id: 12345,
      is_bot: false,
      first_name: "TestUser"
    },
    chat: {
      id: 12345,
      first_name: "TestUser",
      type: "private"
    },
    date: Date.now() / 1000,
    text: "/laporan"
  }
};

fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify(payload)
})
.then(res => res.text().then(text => ({ status: res.status, text })))
.then(data => console.log("Response:", data))
.catch(err => console.error("Error:", err));
