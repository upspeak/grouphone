/* global axios, WebSocket, mediasoupClient */

window.addEventListener('load', function () {
  'use strict'

  var callerName
  var ws
  var room
  var audioProducer
  var transportSend
  var transportRecv
  var API_BASE
  var callId
  var remotePeers = document.getElementById('remotePeers')

  function apiUrl (...segments) {
    var _base = API_BASE.indexOf('/') === 0 ? API_BASE : `${window.location.protocol}//${API_BASE}`
    return `${_base}${segments.join('/')}`
  }

  function handleWebSocketMessage (data) {
    data = JSON.parse(data)
    console.log('Websocket request received', data)
    if (data.type && data.type === 'mediasoupMessage') {
      room.receiveNotification(data.data)
    }
  }

  function setCallId (id) {
    callId = window.location.hash = document.getElementById('callIdInput').value = id
    document.getElementById('joinCall').focus()
  }

  function setAPIBase () {
    API_BASE = document.getElementById('apiBase').value || '/'
    if (!/\/$/.test(API_BASE)) {
      API_BASE = API_BASE + '/'
    }
  }

  function setupRoom (conn) {
    room = new mediasoupClient.Room({})
    room.on('request', (req, callback, errback) => {
      console.log('Sending mediasoup request', req)
      axios.post(apiUrl('call', callId, 'message', conn.connectionId), { message: req })
        .then(res => {
          console.log('Response from request', res)
          callback(res.data.payload)
        })
        .catch(err => {
          console.log('Error in sending mediasoup request', err)
        })
    })
    room.on('notify', notification => {
      console.log('Sending mediasoup request', notification)
      axios.post(apiUrl('call', callId, 'message', conn.connectionId), { message: notification })
        .then(res => {
          console.log('Response from notification', res)
        })
        .catch(err => {
          console.log('Error in sending mediasoup notification', err)
        })
    })
    room.on('newpeer', handlePeer)
    room.join(conn.connectionId, { name: callerName })
      .then(() => {
        console.log('Joined room')
        transportSend = room.createTransport('send')
        transportRecv = room.createTransport('recv')

        transportSend.on('close', e => {
          console.log('Send transport closed', e)
        })
        transportRecv.on('close', e => {
          console.log('Recv transport closed', e)
        })
      })
      .then(() => {
        return navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      })
      .then(stream => {
        audioProducer = room.createProducer(stream.getAudioTracks()[0])
        return audioProducer.send(transportSend)
      })
      .then(() => {
        for (const peer of room.peers) {
          handlePeer(peer)
        }
      })
      .catch(err => {
        console.log('Error joining room', err)
        if (audioProducer) {
          audioProducer.close()
        }
      })

    function handleConsumer (peer, c) {
      console.log(`New consumer for peer`, peer, c)
      const newstream = new MediaStream()
      c.receive(transportRecv)
        .then(track => {
          newstream.addTrack(track)
          const newEl = document.createElement('audio')
          newEl.setAttribute('autoplay', 'true')
          newEl.setAttribute('controls', 'true')
          newEl.id = peer.name
          newEl.srcObject = newstream
          remotePeers.appendChild(newEl)
        })
        .catch(err => {
          console.log('Error receiving new consumer', err)
        })
    }

    function handlePeer (peer) {
      console.log('New peer', peer)
      for (const c of peer.consumers) {
        handleConsumer(peer, c)
      }
      peer.on('newconsumer', c => {
        handleConsumer(peer, c)
      })
      peer.on('close', () => {
        console.log('Peer closed', peer.name)
        const el = document.getElementById(peer.name)
        if (el) {
          el.parentNode.removeChild(el)
        }
      })
    }
  }

  function setupConnection (conn) {
    var wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    var wsBase = API_BASE.indexOf('/') === 0 ? `${window.location.hostname}/` : API_BASE
    ws = new WebSocket(`${wsProtocol}//${wsBase}notifications?callId=${conn.callId}&connectionId=${conn.connectionId}`)
    ws.onopen = function () {
      console.log('Opened Websocket connection')
      setupRoom(conn)
    }
    ws.onerror = function (e) {
      console.log('Error in websocket', e)
    }
    ws.onclose = function () {
      console.log('Websocket connection closed')
    }
    ws.onmessage = function (event) {
      handleWebSocketMessage(event.data)
    }
  }

  function joinCall (e) {
    e.preventDefault()
    e.target.setAttribute('disabled', 'disabled')

    callId = document.getElementById('callIdInput').value
    callerName = document.getElementById('callerNameInput').value
    setAPIBase()
    console.log('Call ID', callId)
    console.log('Caller Name', callerName)
    console.log(apiUrl('call', callId, 'connect'))
    axios.post(apiUrl('call', callId, 'connect'), { name: callerName })
      .then(function (res) {
        console.log('Connection information', res.data.payload)
        window.location.hash = callId
        setupConnection(res.data.payload)
      })
      .catch(function (err) {
        console.log('Error getting connection', err)
        e.target.removeAttribute('disabled')
      })
  }

  function createCall (e) {
    e.preventDefault()
    setAPIBase()
    if (!callId) {
      e.target.setAttribute('disabled', 'disabled')
      axios.post(apiUrl('call'))
        .then(function (res) {
          console.log('Call Created', res.data)
          setCallId(res.data.payload.callId)
        })
        .catch(function (err) {
          console.log('Error creating call', err)
          e.target.removeAttribute('disabled')
        })
    }
  }

  document.getElementById('joinCall').addEventListener('click', joinCall)
  document.getElementById('createCall').addEventListener('click', createCall)

  if (window.location.hash) {
    setCallId(window.location.hash.substr(1))
    document.getElementById('createCall').setAttribute('disabled', 'disabled')
  }
})
