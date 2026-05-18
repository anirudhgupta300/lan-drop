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
  const [status, setStatus] = useState('Connecting...');
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
    setStatus('Waiting for someone to join...');
    setError('');
    console.log('creating room:', NewCode);
    ablyChannelRef.current?.publish('signal', { type: 'join', room: NewCode, role: 'creator' });
  }

  const JoinRoom = () => {
    if(!joinCode || joinCode.length !== 6){
      setError('Please enter a valid 6 character room code');
      return;
    }
    joinCodeRef.current = joinCode;
    setStatus('Joining room...');
    setError('');
    console.log('joining room:', joinCode);
    ablyChannelRef.current?.publish('signal', { type: 'join', room: joinCode, role: 'joiner' });
  }

  const sendFile = () => {
    if(!selectedFile){
      setError('Please select a file first');
      return;
    }
    if(!channelRef.current || channelRef.current.readyState !== 'open'){
      setError('Not connected to a peer yet. Create or join a room first.');
      return;
    }
    setError('');
    setStatus('Sending file...');
    console.log('sending file:', selectedFile.name);
    const reader = new FileReader();
    reader.readAsArrayBuffer(selectedFile);
    reader.onload = (e) => {
      const arraybuffer = e.target?.result as ArrayBuffer;
      try {
        for(let i = 0; i < arraybuffer.byteLength; i += chunksize){
          channelRef.current?.send(arraybuffer.slice(i, i + chunksize))
        }
        channelRef.current?.send(JSON.stringify({ type: 'done', filename: selectedFile.name }))
        setStatus('File sent successfully!')
        console.log('file sent')
      } catch(err) {
        setError('Failed to send file: ' + err)
        console.error('send error:', err)
      }
    }
    reader.onerror = () => {
      setError('Failed to read file');
    }
  }

  useEffect(() => {
    const client = new Ably.Realtime({ authUrl: '/api/ably' });
    
    client.connection.on('connected', () => {
      console.log('Ably connected');
      setStatus('Ready');
    });
    client.connection.on('failed', () => {
      console.log('Ably connection failed');
      setError('Failed to connect to signaling server');
      setStatus('Disconnected');
    });
    client.connection.on('disconnected', () => {
      setStatus('Disconnected — retrying...');
    });

    const channel = client.channels.get('signaling');
    ablyChannelRef.current = channel;

    channel.subscribe('signal', (msg) => {
      const message = msg.data;
      console.log('received message:', message.type, message.room);

      if(message.type == 'join'){
        console.log('join received, my room:', codeRef.current, 'their room:', message.room, 'role:', message.role);
        if(message.role == 'joiner' && codeRef.current == message.room){
          console.log('sending ready');
          setStatus('Peer joined! Establishing connection...');
          channel.publish('signal', { type: 'ready', room: message.room })
        }
      } else if(message.type == 'ready'){
        if(codeRef.current !== message.room) return;
        console.log('ready received, creating offer');
        setStatus('Creating connection...');
        iceCandidatesQueue.current = [];
        peerref.current = new RTCPeerConnection(config);
        peerref.current.onicecandidate = (event) => {
          if(event.candidate){
            channel.publish('signal', { type: 'ice', room: codeRef.current, data: event.candidate })
          }
        }
        peerref.current.onconnectionstatechange = () => {
          const state = peerref.current?.connectionState
          console.log('connection state:', state)
          if(state == 'connected') setStatus('Connected! You can now send files.')
          if(state == 'failed') setError('Peer connection failed')
          if(state == 'disconnected') setStatus('Peer disconnected')
        }
        const sendChannel = peerref.current.createDataChannel('sendchannel');
        sendChannel.binaryType = 'arraybuffer';
        channelRef.current = sendChannel;
        sendChannel.onopen = () => {
          console.log('data channel open')
          setStatus('Connected! You can now send files.')
        }
        sendChannel.onerror = (e) => {
          console.error('data channel error:', e)
          setError('Data channel error')
        }
        peerref.current.createOffer().then((offer) => {
          peerref.current?.setLocalDescription(offer);
          channel.publish('signal', { type: 'offer', room: codeRef.current, data: offer })
        }).catch(err => {
          setError('Failed to create offer: ' + err)
          console.error('offer error:', err)
        })
      } else if(message.type == 'offer'){
        if(joinCodeRef.current !== message.room) return;
        console.log('offer received, creating answer');
        setStatus('Offer received, connecting...');
        iceCandidatesQueue.current = [];
        peerref.current = new RTCPeerConnection(config);
        peerref.current.onicecandidate = (event) => {
          if(event.candidate){
            channel.publish('signal', { type: 'ice', room: joinCodeRef.current, data: event.candidate })
          }
        }
        peerref.current.onconnectionstatechange = () => {
          const state = peerref.current?.connectionState
          console.log('connection state:', state)
          if(state == 'connected') setStatus('Connected! Waiting for file...')
          if(state == 'failed') setError('Peer connection failed')
          if(state == 'disconnected') setStatus('Peer disconnected')
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
                  console.log('file received, triggering download');
                  setStatus('File received! Downloading...');
                  const blob = new Blob(chunks);
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = msg.filename;
                  a.click();
                  setStatus('File downloaded successfully!')
                }
              } catch(err) {
                setError('Error processing received file')
                console.error('receive error:', err)
              }
            } else {
              chunks.push(me.data);
            }
          }
        }
        peerref.current.setRemoteDescription(message.data).then(() => {
          iceCandidatesQueue.current.forEach(candidate => {
            peerref.current?.addIceCandidate(candidate)
          })
          iceCandidatesQueue.current = [];
          return peerref.current?.createAnswer()
        }).then((answer) => {
          if(!answer) return;
          peerref.current?.setLocalDescription(answer);
          channel.publish('signal', { type: 'answer', room: joinCodeRef.current, data: answer })
        }).catch(err => {
          setError('Failed to create answer: ' + err)
          console.error('answer error:', err)
        })
      } else if(message.type == 'ice'){
        const myRoom = codeRef.current || joinCodeRef.current;
        if(message.room !== myRoom) return;
        if(peerref.current?.remoteDescription){
          peerref.current.addIceCandidate(message.data).catch(err => {
            console.error('ice candidate error:', err)
          })
        } else {
          iceCandidatesQueue.current.push(message.data)
        }
      } else if(message.type == 'answer'){
        if(codeRef.current !== message.room) return;
        console.log('answer received');
        peerref.current?.setRemoteDescription(message.data).then(() => {
          iceCandidatesQueue.current.forEach(candidate => {
            peerref.current?.addIceCandidate(candidate)
          })
          iceCandidatesQueue.current = [];
        }).catch(err => {
          setError('Failed to set answer: ' + err)
          console.error('set answer error:', err)
        })
      }
    });

    return () => client.close();
  }, [])

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem 1rem', background: 'var(--background)' }}>
      <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '22px', fontWeight: 700, letterSpacing: '-1px', marginBottom: '4px', color: 'var(--foreground)' }}>⇄ LAN Drop</div>
      <p style={{ fontSize: '13px', color: 'var(--muted)', marginBottom: '0.5rem' }}>Send files directly between devices on the same WiFi</p>
      <p style={{ fontSize: '12px', color: status.includes('Connected') ? '#1D9E75' : 'var(--muted)', marginBottom: '2rem' }}>{status}</p>
      {error && <p style={{ fontSize: '12px', color: '#E24B4A', marginBottom: '1rem', maxWidth: '420px', textAlign: 'center' }}>{error}</p>}

      <div style={{ background: 'var(--card)', border: '0.5px solid var(--border)', borderRadius: '12px', padding: '1.75rem', width: '100%', maxWidth: '420px' }}>

        <div style={{ fontSize: '11px', fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '8px' }}>Your room code</div>
        <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '28px', fontWeight: 700, letterSpacing: '6px', background: 'var(--input-bg)', borderRadius: '8px', padding: '1rem', textAlign: 'center', marginBottom: '1rem', minHeight: '68px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--foreground)' }}>
          {showCode ? code : <span style={{ fontSize: '13px', fontFamily: 'sans-serif', fontWeight: 400, color: 'var(--muted)', letterSpacing: 0 }}>Click to generate</span>}
        </div>
        <button onClick={CreateRoom} style={{ width: '100%', padding: '10px', borderRadius: '8px', fontSize: '14px', fontWeight: 500, cursor: 'pointer', background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-color)', border: 'none', marginBottom: '1.5rem' }}>
          Create room
        </button>

        <hr style={{ border: 'none', borderTop: '0.5px solid var(--border)', margin: '0 0 1.25rem' }} />

        <div style={{ fontSize: '11px', fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '8px' }}>Join a room</div>
        <input type="text" placeholder="A3BX9K" maxLength={6} onChange={(e) => { setjoinCode(e.target.value.toUpperCase()); setError(''); }} value={joinCode} style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '0.5px solid var(--border)', fontSize: '14px', fontFamily: "'Space Mono', monospace", letterSpacing: '2px', marginBottom: '0.75rem', boxSizing: 'border-box', textTransform: 'uppercase', background: 'var(--input-bg)', color: 'var(--foreground)' }} />
        <button onClick={JoinRoom} style={{ width: '100%', padding: '10px', borderRadius: '8px', fontSize: '14px', fontWeight: 500, cursor: 'pointer', background: 'var(--card)', border: '0.5px solid var(--border)', color: 'var(--foreground)', marginBottom: '1.5rem' }}>
          Join room
        </button>

        <hr style={{ border: 'none', borderTop: '0.5px solid var(--border)', margin: '0 0 1.25rem' }} />

        <div style={{ fontSize: '11px', fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '8px' }}>File to send</div>
        <input type="file" onChange={(e) => { setSelectedFile(e.target.files?.[0] || null); setError(''); }} style={{ width: '100%', fontSize: '13px', color: 'var(--foreground)', marginBottom: '0.75rem' }} />
        {selectedFile && <p style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '0.75rem' }}>{selectedFile.name}</p>}
        <button onClick={sendFile} style={{ width: '100%', padding: '10px', borderRadius: '8px', fontSize: '14px', fontWeight: 500, cursor: 'pointer', background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-color)', border: 'none', opacity: selectedFile ? 1 : 0.4 }}>
          Send file
        </button>
      </div>
    </div>
  )
}