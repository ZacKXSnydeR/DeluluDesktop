# Usage Guide

Delulu is designed to be intuitive and fast. Here is how to get the most out of the application.

## 1. Authentication
Upon launching the app, you can sign in or create an account via the **Auth Page**. Authentication is handled securely through Firebase.

## 2. Searching Content
Use the Search bar at the top to find your favorite movies or TV shows. All metadata is synced live from TMDB.

## 3. Playback Controls
- **Extraction:** When you click "Play", the app will spend a few seconds extracting the highest quality stream. You will see a loading indicator during this process.
- **HLS Engine:** The player uses `hls.js` for smooth streaming.
- **Subtitles:** If subtitles are available, they will be automatically detected and can be toggled via the player settings.

## 4. Local Library
- **Watch History:** Your history is automatically saved to a local database. You can continue watching from exactly where you left off.
- **My List:** Add content to your list for quick access later.

## 5. Troubleshooting
- **Slow Extraction:** This usually depends on the provider's speed and your local internet connection.
- **Network Error:** Ensure no firewall is blocking the local HLS proxy (it runs on a dynamic localhost port).
- **Missing Browser:** Delulu needs a Chromium-based browser (Edge, Chrome, Brave) installed on your system to run the extraction engine.
