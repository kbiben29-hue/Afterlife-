//! Afterlife desktop shell. The app itself is the web build in `dist/`; this side only
//! fetches the card list from the official card database (api.netdeck.gg) on the app's
//! behalf, so the request isn't subject to browser CORS rules. Nothing else is fetched,
//! and no card data ships with the app.

/// The only place the app may fetch from.
const ORIGIN: &str = "https://api.netdeck.gg/api/";

fn check_url(url: &str) -> Result<(), String> {
    if url.starts_with(ORIGIN) && !url.contains("..") {
        Ok(())
    } else {
        Err(format!("refusing to fetch {url}"))
    }
}

#[tauri::command]
async fn cards_fetch_text(url: String) -> Result<String, String> {
    check_url(&url)?;
    let client = reqwest::Client::builder()
        .user_agent("Afterlife-desktop (personal card cache)")
        .build()
        .map_err(|e| e.to_string())?;
    let res = client
        .get(&url)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = res.status();
    if !status.is_success() {
        return Err(format!("{} {url}", status.as_u16()));
    }
    res.text().await.map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![cards_fetch_text])
        .run(tauri::generate_context!())
        .expect("error while running Afterlife");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_card_database_is_fetched() {
        assert!(check_url("https://api.netdeck.gg/api/cards/cyberpunk").is_ok());
        assert!(check_url("https://api.netdeck.gg/api/cards/cyberpunk?offset=60&limit=60").is_ok());
        assert!(check_url("https://example.com/x").is_err());
        assert!(check_url("https://api.netdeck.gg/api/../evil").is_err());
    }
}
