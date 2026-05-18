# LanDrop 📡

A peer-to-peer file sharing app that works directly in the browser. No account needed, no file size limits from a server — files go straight from one device to another.

## How it works

1. One person creates a room and gets a 6-character code
2. The other person enters that code to join
3. A direct connection is established between the two devices
4. Files are sent directly — they never touch a server

The only thing that goes through a server is the initial handshake to help the two devices find each other. After that, all data is peer-to-peer and end-to-end encrypted.

## Built with

- **Next.js** — frontend and API routes
- **WebRTC** — direct peer-to-peer file transfer
- **Ably** — real-time signaling to connect devices
- **Vercel** — deployment

## Running locally

**1. Clone the repo**
```bash
git clone https://github.com/yourusername/lan-drop.git
cd lan-drop
```

**2. Install dependencies**
```bash
npm install
```

**3. Set up environment variables**

Create a `.env.local` file in the root:
```
ABLY_API_KEY=your_ably_api_key_here
```

Get a free API key at [ably.com](https://ably.com).

**4. Run the dev server**
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in two browser tabs to test.

## How to use

- Open the app on two devices (or two browser tabs)
- On device A — click **Create room**, note the 6-character code
- On device B — type the code and click **Join room**
- Once connected, pick a file on device A and hit **Send file**
- Device B will automatically download it

## Notes

- Works best when both devices are on the same WiFi network
- Works across different networks too but may be slower
- Files are transferred directly between devices — nothing is stored anywhere
