# Turbo Trails — Online

Arcade kart racing you can play with friends from a link, with no account needed for them.

## What's in this folder

| File | What it does |
|---|---|
| `public/index.html` | The whole game (tracks, Grand Prix, Garage, Online mode) |
| `server.js` | The small multiplayer server: room codes, lobbies, and passing race updates between players |
| `package.json` | Tells the host which add-ons to install (Express, ws, three.js) |
| `render.yaml` | Optional one-click settings for Render |

## Put it online for free (about 10 minutes, one time)

You need two free accounts: **GitHub** (stores the files) and **Render** (runs the game).

### 1. Upload the files to GitHub
1. Go to **github.com**, sign up or log in.
2. Click **+** (top right) → **New repository**. Name it `turbo-trails`, leave it **Public**, click **Create repository**.
3. On the new page, click **uploading an existing file**.
4. Unzip `turbo-trails-online.zip` on your computer, open the folder, and drag **everything inside it** (including the `public` folder) into the upload box.
5. Click **Commit changes**.

### 2. Run it on Render
1. Go to **render.com** and sign up with your GitHub account.
2. Click **New** → **Web Service**, then pick your `turbo-trails` repository.
3. Use these settings:
   - **Language / Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
4. Click **Deploy Web Service**. After a couple of minutes it shows **Live** and gives you a web address like `https://turbo-trails-xxxx.onrender.com`.

That address is your game. Open it, choose **Online 🌐 → Create a room**, then press **Copy link** and send it to your friends.

## Good to know

- **Free plan nap:** Render puts free services to sleep after 15 minutes with nobody playing. The first person to open the link afterwards waits about a minute while it wakes up; after that it's instant.
- **Up to 6 racers per room.** Computer racers fill any empty places (the host can switch them off).
- **The host** (whoever made the room) picks the track and number of laps and starts each race. If the host leaves, someone else takes over automatically.
- **Garage karts, names and numbers** show up for everyone. Each player's Garage is saved in their own browser.
- **Updating the game later:** upload the changed files to the same GitHub repository and Render rebuilds the site automatically.

## Running it on your own computer (optional)

With Node.js 18+ installed, open a terminal in this folder and run:

```
npm install
npm start
```

Then open http://localhost:3000. Friends on the same Wi-Fi can join using your computer's local IP address, for example `http://192.168.1.20:3000`.
