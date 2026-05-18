'use client'
import { useEffect, useRef, useState } from "react";
import Ably from 'ably';

const chunksize = 16000;
const config = {
  iceServers:[{ urls: 'stun:stun.l.google.com:19302' }]
}

export default function Home() {
  const [showCode, Setshowcode] = useState(false);
  const [code, setcode] = useState('');
  const [joinCode, setjoinCode] = useState('');
  const [selectedFile, setSelectedFile] = useState<File|null>(null);
  const [status, setStatus] = useState('initializing');
  const [error, setError] = useState('');
  const codeRef = useRef('');
  const joinCodeRef = useRef('');
  const peerref = useRef<RTCPeerConnection|null>(null);
  const channelRef = useRef<RTCDataChannel|null>(null);
  const ablyChannelRef = useRef<Ably.RealtimeChannel|null>(null);
  const iceCandidatesQueue = useRef<RTCIceCandidateInit[]>([]);

  const CreateRoom = () => {
    const NewCode = Math.random().toString(36).substring(2,8).toUpperCase();
    setcode(NewCode);
    Setshowcode(true);
    codeRef.current = NewCode;
    setStatus('waiting for someone to join');
    setError('');
    ablyChannelRef.current?.publish('signal', { type: 'join', room: NewCode, role: 'creator' });
  }

  const JoinRoom = () => {
    if(!joinCode || joinCode.length !== 6){ setError('enter a valid 6-character code'); return; }
    joinCodeRef.current = joinCode;
    setStatus('joining room...');
    setError('');
    ablyChannelRef.current?.publish('signal', { type: 'join', room: joinCode, role: 'joiner' });
  }

  const sendFile = () => {
    if(!selectedFile){ setError('pick a file first'); return; }
    if(!channelRef.current || channelRef.current.readyState !== 'open'){ setError('not connected yet'); return; }
    setError('');
    setStatus('sending...');
    const reader = new FileReader();
    reader.readAsArrayBuffer(selectedFile);
    reader.onload = (e) => {
      const arraybuffer = e.target?.result as ArrayBuffer;
      try {
        for(let i = 0; i < arraybuffer.byteLength; i += chunksize){
          channelRef.current?.send(arraybuffer.slice(i, i + chunksize))
        }
        channelRef.current?.send(JSON.stringify({ type: 'done', filename: selectedFile.name }))
        setStatus('sent!')
      } catch { setError('send failed') }
    }
    reader.onerror = () => setError('could not read file')
  }

  useEffect(() => {
    const client = new Ably.Realtime({ authUrl: '/api/ably' });
    client.connection.on('connected', () => setStatus('ready'));
    client.connection.on('failed', () => { setError('could not connect'); setStatus('error'); });
    client.connection.on('disconnected', () => setStatus('reconnecting...'));

    const channel = client.channels.get('signaling');
    ablyChannelRef.current = channel;

    channel.subscribe('signal', (msg) => {
      const message = msg.data;
      if(message.type == 'join'){
        if(message.role == 'joiner' && codeRef.current == message.room){
          setStatus('someone joined!');
          channel.publish('signal', { type: 'ready', room: message.room })
        }
      } else if(message.type == 'ready'){
        if(codeRef.current !== message.room) return;
        setStatus('connecting...');
        iceCandidatesQueue.current = [];
        peerref.current = new RTCPeerConnection(config);
        peerref.current.onicecandidate = (event) => {
          if(event.candidate) channel.publish('signal', { type: 'ice', room: codeRef.current, data: event.candidate })
        }
        peerref.current.onconnectionstatechange = () => {
          const s = peerref.current?.connectionState
          if(s == 'connected') setStatus('connected — send a file')
          if(s == 'failed') setError('connection failed')
          if(s == 'disconnected') setStatus('disconnected')
        }
        const sendChannel = peerref.current.createDataChannel('sendchannel');
        sendChannel.binaryType = 'arraybuffer';
        channelRef.current = sendChannel;
        sendChannel.onopen = () => setStatus('connected — send a file')
        sendChannel.onerror = () => setError('data channel error')
        peerref.current.createOffer().then((offer) => {
          peerref.current?.setLocalDescription(offer);
          channel.publish('signal', { type: 'offer', room: codeRef.current, data: offer })
        }).catch(() => setError('offer failed'))
      } else if(message.type == 'offer'){
        if(joinCodeRef.current !== message.room) return;
        setStatus('connecting...');
        iceCandidatesQueue.current = [];
        peerref.current = new RTCPeerConnection(config);
        peerref.current.onicecandidate = (event) => {
          if(event.candidate) channel.publish('signal', { type: 'ice', room: joinCodeRef.current, data: event.candidate })
        }
        peerref.current.onconnectionstatechange = () => {
          const s = peerref.current?.connectionState
          if(s == 'connected') setStatus('connected — waiting for file')
          if(s == 'failed') setError('connection failed')
          if(s == 'disconnected') setStatus('disconnected')
        }
        peerref.current.ondatachannel = (e) => {
          const ch = e.channel;
          ch.binaryType = 'arraybuffer';
          const chunks: ArrayBuffer[] = [];
          ch.onmessage = (me) => {
            if(typeof me.data == 'string'){
              try {
                const msg = JSON.parse(me.data);
                if(msg.type == 'done'){
                  const blob = new Blob(chunks);
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url; a.download = msg.filename; a.click();
                  setStatus('file received!')
                }
              } catch { setError('receive error') }
            } else { chunks.push(me.data) }
          }
        }
        peerref.current.setRemoteDescription(message.data).then(() => {
          iceCandidatesQueue.current.forEach(c => peerref.current?.addIceCandidate(c))
          iceCandidatesQueue.current = [];
          return peerref.current?.createAnswer()
        }).then((answer) => {
          if(!answer) return;
          peerref.current?.setLocalDescription(answer);
          channel.publish('signal', { type: 'answer', room: joinCodeRef.current, data: answer })
        }).catch(() => setError('answer failed'))
      } else if(message.type == 'ice'){
        const myRoom = codeRef.current || joinCodeRef.current;
        if(message.room !== myRoom) return;
        if(peerref.current?.remoteDescription){
          peerref.current.addIceCandidate(message.data).catch(() => {})
        } else { iceCandidatesQueue.current.push(message.data) }
      } else if(message.type == 'answer'){
        if(codeRef.current !== message.room) return;
        peerref.current?.setRemoteDescription(message.data).then(() => {
          iceCandidatesQueue.current.forEach(c => peerref.current?.addIceCandidate(c))
          iceCandidatesQueue.current = [];
        }).catch(() => setError('set answer failed'))
      }
    });

    return () => client.close();
  }, [])

  const isConnected = status.includes('connected') || status === 'sent!' || status === 'file received!'
  const statusColor = isConnected ? '#22c55e' : error ? '#ef4444' : '#94a3b8'

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Mona+Sans:wght@300;400;500;600;700;900&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        body {
          font-family: 'Mona Sans', 'Inter', sans-serif;
          background: #0a0a0f;
          color: #f1f0ff;
          min-height: 100vh;
        }

        .wrap {
          min-height: 100vh;
          display: grid;
          place-items: center;
          padding: 2rem 1rem;
          position: relative;
        }

        .bg-blobs {
          position: fixed;
          inset: 0;
          pointer-events: none;
          overflow: hidden;
          z-index: 0;
        }

        .blob {
          position: absolute;
          border-radius: 50%;
          filter: blur(80px);
          opacity: 0.18;
        }

        .blob-1 { width: 500px; height: 500px; background: #7c3aed; top: -100px; left: -100px; }
        .blob-2 { width: 400px; height: 400px; background: #db2777; bottom: -80px; right: -80px; }
        .blob-3 { width: 300px; height: 300px; background: #0ea5e9; top: 40%; left: 60%; }

        .inner {
          position: relative;
          z-index: 1;
          width: 100%;
          max-width: 420px;
        }

        .top {
          margin-bottom: 2.5rem;
        }

        .wordmark {
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: #6d6d8a;
          margin-bottom: 20px;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .wordmark::before {
          content: '';
          display: block;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: linear-gradient(135deg, #7c3aed, #db2777);
        }

        .headline {
          font-size: 38px;
          font-weight: 900;
          line-height: 1.05;
          letter-spacing: -1.5px;
          color: #f1f0ff;
          margin-bottom: 10px;
        }

        .headline em {
          font-style: normal;
          background: linear-gradient(90deg, #a78bfa, #f472b6, #38bdf8);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .sub {
          font-size: 14px;
          color: #6d6d8a;
          line-height: 1.5;
          margin-bottom: 14px;
        }

        .status-chip {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 500;
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.07);
          color: #6d6d8a;
        }

        .dot {
          width: 6px; height: 6px;
          border-radius: 50%;
          flex-shrink: 0;
          animation: blink 2s infinite;
        }

        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.3} }

        .err {
          font-size: 12px;
          color: #f87171;
          background: rgba(239,68,68,0.08);
          border: 1px solid rgba(239,68,68,0.15);
          border-radius: 10px;
          padding: 8px 12px;
          margin-bottom: 10px;
        }

        .panel {
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 18px;
          padding: 18px;
          margin-bottom: 10px;
          backdrop-filter: blur(20px);
        }

        .panel-label {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          color: #4a4a6a;
          margin-bottom: 12px;
        }

        .code-slot {
          background: rgba(0,0,0,0.3);
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 12px;
          padding: 14px;
          text-align: center;
          font-size: 30px;
          font-weight: 900;
          letter-spacing: 9px;
          color: #a78bfa;
          margin-bottom: 12px;
          min-height: 66px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .empty-code {
          font-size: 12px;
          font-weight: 500;
          letter-spacing: 0.05em;
          color: #2e2e4a;
        }

        .btn {
          width: 100%;
          padding: 12px;
          border-radius: 12px;
          font-size: 13px;
          font-family: inherit;
          font-weight: 600;
          cursor: pointer;
          transition: opacity 0.15s, transform 0.1s;
          border: none;
          letter-spacing: 0.02em;
        }

        .btn:active { transform: scale(0.98); }

        .btn-violet {
          background: linear-gradient(135deg, #7c3aed 0%, #a855f7 100%);
          color: #fff;
        }

        .btn-violet:hover { opacity: 0.88; }

        .btn-ghost {
          background: rgba(255,255,255,0.06);
          color: #a0a0c0;
          border: 1px solid rgba(255,255,255,0.08);
        }

        .btn-ghost:hover { background: rgba(255,255,255,0.09); color: #f1f0ff; }

        .inp {
          width: 100%;
          padding: 12px 14px;
          background: rgba(0,0,0,0.3);
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 12px;
          color: #f1f0ff;
          font-family: inherit;
          font-size: 16px;
          font-weight: 700;
          letter-spacing: 6px;
          text-transform: uppercase;
          text-align: center;
          margin-bottom: 10px;
          outline: none;
          transition: border-color 0.15s;
        }

        .inp:focus { border-color: #7c3aed; }
        .inp::placeholder { color: #2a2a40; letter-spacing: 3px; font-weight: 400; font-size: 13px; }

        .file-pick {
          position: relative;
          background: rgba(0,0,0,0.3);
          border: 1.5px dashed rgba(255,255,255,0.08);
          border-radius: 12px;
          padding: 18px;
          text-align: center;
          cursor: pointer;
          margin-bottom: 10px;
          transition: border-color 0.15s, background 0.15s;
        }

        .file-pick:hover { border-color: #7c3aed; background: rgba(124,58,237,0.05); }

        .file-pick input {
          position: absolute; inset: 0;
          opacity: 0; cursor: pointer;
          width: 100%; height: 100%;
        }

        .file-icon { font-size: 26px; margin-bottom: 4px; }

        .file-hint {
          font-size: 12px;
          color: #3a3a5a;
          font-weight: 500;
        }

        .file-chosen {
          font-size: 12px;
          color: #a78bfa;
          font-weight: 600;
          word-break: break-all;
        }

        .foot {
          text-align: center;
          margin-top: 2rem;
          font-size: 11px;
          color: #2a2a3a;
          letter-spacing: 0.05em;
        }
      `}</style>

      <div className="wrap">
        <div className="bg-blobs">
          <div className="blob blob-1" />
          <div className="blob blob-2" />
          <div className="blob blob-3" />
        </div>

        <div className="inner">
          <div className="top">
            <div className="wordmark">LanDrop</div>
            <h1 className="headline">Drop files,<br /><em>instantly.</em></h1>
            <p className="sub">No cables. No cloud. Just two devices on the same WiFi.</p>
            <div className="status-chip">
              <div className="dot" style={{ background: statusColor }} />
              <span style={{ color: statusColor }}>{status}</span>
            </div>
          </div>

          {error && <div className="err">{error}</div>}

          <div className="panel">
            <div className="panel-label">Create a room</div>
            <div className="code-slot">
              {showCode ? code : <span className="empty-code">your code appears here</span>}
            </div>
            <button className="btn btn-violet" onClick={CreateRoom}>
              {showCode ? 'Regenerate code' : 'Create room'}
            </button>
          </div>

          <div className="panel">
            <div className="panel-label">Join a room</div>
            <input
              className="inp"
              type="text"
              placeholder="Enter code"
              maxLength={6}
              onChange={(e) => { setjoinCode(e.target.value.toUpperCase()); setError(''); }}
              value={joinCode}
            />
            <button className="btn btn-ghost" onClick={JoinRoom}>Join room</button>
          </div>

          <div className="panel">
            <div className="panel-label">Send a file</div>
            <div className="file-pick">
              <input type="file" onChange={(e) => { setSelectedFile(e.target.files?.[0] || null); setError(''); }} />
              {selectedFile ? (
                <div className="file-chosen">📎 {selectedFile.name}</div>
              ) : (
                <>
                  
                  <div className="file-hint">tap to choose a file</div>
                </>
              )}
            </div>
            <button
              className="btn btn-violet"
              onClick={sendFile}
              style={{ opacity: selectedFile ? 1 : 0.35 }}
            >
              Send file
            </button>
          </div>

          <div className="foot">end-to-end encrypted · peer to peer</div>
        </div>
      </div>
    </>
  )
}