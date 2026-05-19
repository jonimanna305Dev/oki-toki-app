
  (function(){
    // ==================== UNLIMITED RANGE FOR BANGLADESH / GLOBAL ====================
    // Each device gets a persistent 6-character ID stored in localStorage (unique across refreshes)
    // WebRTC P2P connections work across any distance with no range limit.
    
    let peer = null;
    let myShortId = null;
    let myFullPeerId = null;
    let connections = new Map();
    let mediaRecorder = null;
    let audioChunks = [];
    let isRecording = false;
    let recordingTimer = null;
    let waveInterval = null;
    let currentStream = null;
    let pttLock = false;
    const MAX_RECORD_MS = 9000;
    
    let audioElement = null;
    let currentSinkId = null;
    
    // DOM elements
    const pttButton = document.getElementById('pttButton');
    const waveBars = document.querySelectorAll('.wave-bar');
    const messageListDiv = document.getElementById('messageList');
    const myDeviceSpan = document.getElementById('myDeviceId');
    const connLedSpan = document.getElementById('connLed');
    const connTextSpan = document.getElementById('connText');
    const peerCountSpan = document.getElementById('peerCount');
    const inviteInput = document.getElementById('inviteLinkInput');
    const copyBtn = document.getElementById('copyInviteBtn');
    const resetBtn = document.getElementById('resetPeerBtn');
    const clearLogBtn = document.getElementById('clearLogBtn');
    const rangeStatusSpan = document.getElementById('rangeStatus');
    const sendTextMsgBtn = document.getElementById('sendTextMsgBtn');
    const textMessageInput = document.getElementById('textMessageInput');
    const connectPeerBtn = document.getElementById('connectPeerBtn');
    const remotePeerIdInput = document.getElementById('remotePeerId');
    const speakerPhoneBtn = document.getElementById('speakerPhoneBtn');
    const earpieceBtn = document.getElementById('earpieceBtn');
    
    // Generate a unique 6-character device ID (permanent)
    function generateUniqueDeviceId() {
      const STORAGE_KEY = 'oki_toki_unlimited_bd';
      let storedId = localStorage.getItem(STORAGE_KEY);
      
      if (storedId && storedId.length === 6 && /^[A-Z0-9]{6}$/.test(storedId)) {
        console.log('Restored device ID:', storedId);
        return storedId;
      }
      
      // Fresh permanent ID generation: ensures each browser gets fixed unique ID
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
      let newId = '';
      for(let i = 0; i < 6; i++) {
        newId += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      // Add short hash from timestamp + random to avoid collisions
      const hashPart = Date.now().toString(36).slice(-2).toUpperCase();
      newId = newId.slice(0, 4) + hashPart;
      if (newId.length > 6) newId = newId.slice(0, 6);
      if (newId.length < 6) newId = newId.padEnd(6, 'X');
      
      localStorage.setItem(STORAGE_KEY, newId);
      console.log('Generated new unlimited device ID:', newId);
      return newId;
    }
    
    function createFullPeerId(shortId) { return 'okt_unl_' + shortId; }
    function extractShortId(fullId) { 
      if (fullId && fullId.startsWith('okt_unl_')) return fullId.substring(8);
      if (fullId && fullId.startsWith('okt_')) return fullId.substring(4);
      return fullId;
    }
    
    function addLogMessage(text, isIncoming = false, type = 'text') {
      const msgDiv = document.createElement('div');
      msgDiv.className = `msg-bubble ${isIncoming ? 'incoming-msg' : ''}`;
      const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute:'2-digit', second:'2-digit' });
      let icon = type === 'voice' ? '<i class="bi bi-mic-fill me-1" style="color: #ffaa77;"></i>' : '<i class="bi bi-chat-square-text me-1" style="color: #8bb9fe;"></i>';
      msgDiv.innerHTML = `<div><div class="d-flex justify-content-between align-items-start"><div>${icon} ${text}</div><span class="msg-time">${time}</span></div></div>`;
      messageListDiv.appendChild(msgDiv);
      msgDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      while(messageListDiv.children.length > 60) messageListDiv.removeChild(messageListDiv.firstChild);
    }
    
    function startWaveAnimation() {
      if(waveInterval) clearInterval(waveInterval);
      waveInterval = setInterval(() => {
        if(!isRecording) return;
        waveBars.forEach(bar => {
          const h = 8 + Math.random() * 28;
          bar.style.height = `${h}px`;
          bar.style.backgroundColor = '#f39c12';
        });
      }, 90);
    }
    
    function stopWaveAnimation() {
      if(waveInterval) clearInterval(waveInterval);
      waveBars.forEach(bar => { bar.style.height = '6px'; bar.style.backgroundColor = '#ff8866'; });
    }
    
    function updateConnectionUI() {
      const activeConns = Array.from(connections.values()).filter(conn => conn.open === true);
      const count = activeConns.length;
      peerCountSpan.innerText = `${count} peer${count !==1 ? 's' : ''}`;
      if(count > 0) {
        connLedSpan.className = 'status-led';
        connTextSpan.innerText = `${count} linked (unlimited range)`;
        pttButton.classList.remove('disabled-ptt');
      } else {
        connLedSpan.className = 'status-led offline-led';
        connTextSpan.innerText = 'no peer';
        pttButton.classList.add('disabled-ptt');
      }
    }
    
    function broadcastToPeers(data) {
      let sent = 0;
      for(let [pid, conn] of connections.entries()) {
        if(conn.open && conn.peerConnection) {
          try { conn.send(data); sent++; } catch(e) { console.warn(e); }
        } else if(conn.open) {
          try { conn.send(data); sent++; } catch(e) {}
        }
      }
      return sent;
    }
    
    function playAudioFromBase64(base64Audio, mimeType = 'audio/webm') {
      if (!audioElement) {
        audioElement = new Audio();
        if (currentSinkId && audioElement.setSinkId) {
          audioElement.setSinkId(currentSinkId).catch(e => console.warn("sink error", e));
        }
      }
      try {
        const byteCharacters = atob(base64Audio.split(',')[1]);
        const byteNumbers = new Uint8Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i);
        const blob = new Blob([byteNumbers], { type: mimeType || 'audio/webm' });
        const blobUrl = URL.createObjectURL(blob);
        audioElement.pause();
        audioElement.src = blobUrl;
        audioElement.load();
        audioElement.play().catch(e => { console.warn("autoplay blocked", e); addLogMessage(`🔊 Tap anywhere to enable audio (unlimited range active)`, true, 'text'); });
        audioElement.onended = () => URL.revokeObjectURL(blobUrl);
        audioElement.onerror = () => URL.revokeObjectURL(blobUrl);
      } catch(e) { console.error("audio decode error", e); addLogMessage(`🔊 Voice decode issue`, true, 'text'); }
    }
    
    async function stopRecording() {
      if(!isRecording) return;
      if(mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
      if(recordingTimer) clearTimeout(recordingTimer);
      isRecording = false;
      pttLock = false;
      pttButton.classList.remove('active-push');
      stopWaveAnimation();
      if(currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
        currentStream = null;
      }
      mediaRecorder = null;
    }
    
    function getSupportedMimeType() {
      const types = ['audio/webm', 'audio/mp4', 'audio/ogg'];
      for(const t of types) if(MediaRecorder.isTypeSupported(t)) return t;
      return '';
    }
    
    async function startRecording() {
      if(isRecording || pttLock) return;
      if(!connectionStatusCheck()) {
        addLogMessage(`⚠️ No peer connected. Share your UNIQUE ID: ${myShortId} & connect first! (unlimited range ready)`, false, 'text');
        return;
      }
      pttLock = true;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        currentStream = stream;
        const mimeType = getSupportedMimeType();
        mediaRecorder = new MediaRecorder(stream, { mimeType: mimeType || undefined });
        audioChunks = [];
        mediaRecorder.ondataavailable = (e) => { if(e.data && e.data.size > 0) audioChunks.push(e.data); };
        mediaRecorder.onstop = async () => {
          if(audioChunks.length === 0) { addLogMessage(`🔇 No audio captured`, false, 'text'); return; }
          const audioBlob = new Blob(audioChunks, { type: mimeType || 'audio/webm' });
          if(audioBlob.size > 600) {
            const reader = new FileReader();
            reader.readAsDataURL(audioBlob);
            reader.onloadend = () => {
              const base64Audio = reader.result;
              const sentCount = broadcastToPeers({ type: 'voice', payload: base64Audio, senderId: myShortId, timestamp: Date.now(), mimetype: mimeType || 'audio/webm' });
              addLogMessage(`🎙️ Voice transmitted (${(audioBlob.size/1024).toFixed(1)} KB) — unlimited range`, false, 'voice');
              if(sentCount === 0) addLogMessage(`⚠️ No peers, voice not delivered`, false, 'text');
            };
          } else { addLogMessage(`🔇 Voice too short, ignored`, false, 'text'); }
        };
        mediaRecorder.start(100);
        isRecording = true;
        pttButton.classList.add('active-push');
        startWaveAnimation();
        recordingTimer = setTimeout(() => { if(isRecording) { stopRecording(); addLogMessage(`⏱️ Auto-stop (max 9s)`, false, 'text'); } }, MAX_RECORD_MS);
      } catch(err) {
        console.error(err);
        addLogMessage(`🎤 Microphone error: ${err.message}. Allow mic for unlimited talk.`, false, 'text');
        pttLock = false;
      }
    }
    
    function connectionStatusCheck() {
      for(let conn of connections.values()) if(conn.open) return true;
      return false;
    }
    
    function handleIncomingMessage(data, fromPeerId) {
      const shortFromId = extractShortId(fromPeerId);
      if(data && data.type === 'voice') {
        playAudioFromBase64(data.payload, data.mimetype || 'audio/webm');
        addLogMessage(`🔊 Voice from ${shortFromId} (unlimited distance)`, true, 'voice');
      } else if(data && data.type === 'text') {
        addLogMessage(`${data.message}`, true, 'text');
      }
    }
    
    function sendTextMessage() {
      let msg = textMessageInput.value.trim();
      if(!msg) return;
      if(msg.length > 120) msg = msg.slice(0,120);
      if(!connectionStatusCheck()) { addLogMessage(`⚠️ No peer connected. Share your ID: ${myShortId} to talk across Bangladesh.`, false, 'text'); return; }
      const fullMsg = `✉️ ${msg}`;
      const sent = broadcastToPeers({ type: 'text', message: fullMsg, senderId: myShortId });
      if(sent > 0) {
        addLogMessage(`You: ${msg}`, false, 'text');
        textMessageInput.value = '';
      } else { addLogMessage(`❌ Failed to send message`, false, 'text'); }
    }
    
    function setupConnection(conn) {
      const peerId = conn.peer;
      const shortPeerId = extractShortId(peerId);
      connections.set(peerId, conn);
      updateConnectionUI();
      conn.on('open', () => {
        addLogMessage(`🔗 Connected with ${shortPeerId} — unlimited range active! 🇧🇩`, false, 'text');
        updateConnectionUI();
        try { conn.send({ type: 'text', message: `🟢 ${myShortId} joined (Bangladesh unlimited range)` }); } catch(e) {}
      });
      conn.on('data', (data) => handleIncomingMessage(data, peerId));
      conn.on('close', () => {
        connections.delete(peerId);
        updateConnectionUI();
        addLogMessage(`❌ Disconnected from ${shortPeerId}`, false, 'text');
      });
      conn.on('error', (err) => { console.warn("Connection error", err); if(!conn.open) { connections.delete(peerId); updateConnectionUI(); } });
      if(conn.open) updateConnectionUI();
    }
    
    function connectToPeer(shortId) {
      if(!shortId || shortId.length !== 6) { addLogMessage(`❌ Enter valid 6-character ID (letters + numbers)`, false, 'text'); return false; }
      const fullRemoteId = "okt_unl_" + shortId.toUpperCase();
      if(fullRemoteId === myFullPeerId) { addLogMessage(`❌ Cannot connect to yourself`, false, 'text'); return false; }
      if(connections.has(fullRemoteId)) { addLogMessage(`⚠️ Already connected to ${shortId}`, false, 'text'); return false; }
      const newConn = peer.connect(fullRemoteId, { reliable: true });
      setupConnection(newConn);
      addLogMessage(`🔌 Connecting to ${shortId} (unlimited range)...`, false, 'text');
      return true;
    }
    
    function initPeer() {
      if(peer) {
        peer.destroy();
        connections.clear();
      }
      
      // Unique permanent ID for unlimited coverage
      myShortId = generateUniqueDeviceId();
      myFullPeerId = createFullPeerId(myShortId);
      
      peer = new Peer(myFullPeerId, { 
        debug: 0, 
        config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] } 
      });
      
      peer.on('open', (id) => {
        myDeviceSpan.innerText = myShortId;
        inviteInput.value = myShortId;
        addLogMessage(`🟢 Device ready · UNIQUE ID: ${myShortId} (permanent for this browser) · Unlimited range across Bangladesh & world`, false, 'text');
        updateConnectionUI();
      });
      
      peer.on('connection', (conn) => setupConnection(conn));
      
      peer.on('error', (err) => {
        console.error(err);
        if(err.type === 'peer-unavailable') addLogMessage(`⚠️ Peer ID not found - check the 6-char ID`, false, 'text');
        else if(err.type === 'unavailable-id') addLogMessage(`⚠️ ID conflict! generating new one...`, false, 'text');
        else addLogMessage(`⚠️ Peer error: ${err.type}`, false, 'text');
      });
      
      peer.on('disconnected', () => { 
        addLogMessage(`📡 Reconnecting signaling (unlimited range preserved)`, false, 'text'); 
        peer.reconnect(); 
      });
    }
    
    async function setAudioOutput(deviceType) {
      if (!audioElement) {
        audioElement = new Audio();
      }
      if (typeof audioElement.setSinkId === 'function') {
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const audioOutputs = devices.filter(d => d.kind === 'audiooutput');
          let targetDevice = null;
          if (deviceType === 'speaker') {
            targetDevice = audioOutputs.find(d => d.label.toLowerCase().includes('speaker') || d.label.toLowerCase().includes('built-in')) || audioOutputs[0];
          } else {
            targetDevice = audioOutputs.find(d => d.label.toLowerCase().includes('earpiece') || d.label.toLowerCase().includes('receiver') || d.label.toLowerCase().includes('handset')) || audioOutputs[0];
          }
          if (targetDevice) {
            await audioElement.setSinkId(targetDevice.deviceId);
            currentSinkId = targetDevice.deviceId;
            addLogMessage(`🔊 Audio routed to ${deviceType === 'speaker' ? 'Speaker' : 'Earpiece'}`, false, 'text');
          }
        } catch(err) { console.warn("setSinkId", err); }
      }
      if(deviceType === 'speaker') {
        speakerPhoneBtn.classList.add('active');
        earpieceBtn.classList.remove('active');
      } else {
        earpieceBtn.classList.add('active');
        speakerPhoneBtn.classList.remove('active');
      }
    }
    
    function displayUnlimitedRange() {
      rangeStatusSpan.innerHTML = `<i class="bi bi-infinity"></i> Unlimited Range (Global)`;
    }
    
    function clearLog() {
      while(messageListDiv.firstChild) messageListDiv.removeChild(messageListDiv.firstChild);
      const emptyMsg = document.createElement('div');
      emptyMsg.className = 'text-center py-4';
      emptyMsg.style.color = '#f0c674';
      emptyMsg.innerHTML = '📭 Log cleared · Unlimited range active · Share your ID across Bangladesh';
      messageListDiv.appendChild(emptyMsg);
    }
    
    function attachPTTEvents() {
      const startTalk = (e) => { e.preventDefault(); if(!connectionStatusCheck()) { addLogMessage(`⚠️ No peer connected. Share ID: ${myShortId} & link first.`, false, 'text'); return; } startRecording(); };
      const stopTalk = (e) => { e.preventDefault(); if(isRecording) stopRecording(); };
      pttButton.removeEventListener('mousedown', startTalk);
      pttButton.removeEventListener('mouseup', stopTalk);
      pttButton.removeEventListener('mouseleave', stopTalk);
      pttButton.removeEventListener('touchstart', startTalk);
      pttButton.removeEventListener('touchend', stopTalk);
      pttButton.removeEventListener('touchcancel', stopTalk);
      pttButton.addEventListener('mousedown', startTalk);
      pttButton.addEventListener('mouseup', stopTalk);
      pttButton.addEventListener('mouseleave', stopTalk);
      pttButton.addEventListener('touchstart', startTalk, { passive: false });
      pttButton.addEventListener('touchend', stopTalk);
      pttButton.addEventListener('touchcancel', stopTalk);
    }
    
    remotePeerIdInput.addEventListener('input', function(e) {
      this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0,6);
    });
    
    function bootstrap() {
      initPeer();
      attachPTTEvents();
      displayUnlimitedRange();
      
      copyBtn.onclick = () => { 
        inviteInput.select(); 
        document.execCommand('copy'); 
        addLogMessage(`📋 Copied your permanent device ID: ${myShortId} — share with friends for unlimited talk`, false, 'text'); 
      };
      
      resetBtn.onclick = () => { 
        if(isRecording) stopRecording(); 
        if(peer) peer.destroy(); 
        connections.clear(); 
        initPeer();  // Keep same ID from localStorage
        addLogMessage(`🔄 Connection reset. Your unique ID remains: ${myShortId} (unlimited range enabled)`, false, 'text'); 
      };
      
      clearLogBtn.onclick = clearLog;
      sendTextMsgBtn.onclick = sendTextMessage;
      textMessageInput.onkeypress = (e) => { if(e.key === 'Enter') sendTextMessage(); };
      
      connectPeerBtn.onclick = () => { 
        const rid = remotePeerIdInput.value.trim(); 
        if(rid && rid.length === 6) connectToPeer(rid); 
        else addLogMessage(`❌ Enter valid 6-character ID`, false, 'text'); 
      };
      
      speakerPhoneBtn.onclick = () => setAudioOutput('speaker');
      earpieceBtn.onclick = () => setAudioOutput('earpiece');
      setAudioOutput('speaker');
      setInterval(() => updateConnectionUI(), 3000);
    }
    
    bootstrap();
  })();
