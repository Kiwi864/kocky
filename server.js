const express = require('express')
const http = require('http')
const { Server } = require('socket.io')

const app = express()
const server = http.createServer(app)
const io = new Server(server)

app.use(express.static('.'))

const rooms = {}
const socketRoom = {}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I

function generateCode() {
    let code
    do {
        code = Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('')
    } while (rooms[code])
    return code
}

function createRoomState(code, name, isPublic) {
    return {
        code,
        name,
        isPublic,
        players: [],
        names: {},
        scores: {},
        targetScore: null,
        currentPlayer: null,
        currentRoll: [],
        diceRemaining: 6,
        turnPoints: 0,
        phase: 'waiting',
        winner: null,
        roundHistory: []
    }
}

function publicRoomsList() {
    return Object.values(rooms)
        .filter(r => r.isPublic && r.phase === 'waiting' && r.players.length < 2)
        .map(r => ({ code: r.code, name: r.name, playerCount: r.players.length }))
}

function broadcastPublicRooms() {
    io.emit('publicRooms', publicRoomsList())
}

function getRoom(socket) {
    const code = socketRoom[socket.id]
    if (!code) return null
    return rooms[code] || null
}

function rollDice(count) {
    return Array.from({ length: count }, () => Math.floor(Math.random() * 6) + 1)
}

function scoreSelection(dice) {
    const sorted = [...dice].sort((a, b) => a - b).join(',')

    if (sorted === '1,2,3,4,5,6') return 1500
    if (sorted === '1,2,3,4,5') return 500
    if (sorted === '2,3,4,5,6') return 750

    const counts = {}
    for (const d of dice) counts[d] = (counts[d] || 0) + 1

    let score = 0
    for (const [face, count] of Object.entries(counts)) {
        const f = parseInt(face)
        if (count >= 3) {
            const base = f === 1 ? 1000 : f * 100
            score += base * Math.pow(2, count - 3)
        } else {
            if (f === 1) score += count * 100
            if (f === 5) score += count * 50
        }
    }
    return score
}

function addPlayerToRoom(socket, room, playerName) {
    room.players.push(socket.id)
    room.names[socket.id] = playerName
    room.scores[socket.id] = 0
    if (room.players.length === 2) room.phase = 'setup'
    socketRoom[socket.id] = room.code
    socket.join(room.code)
}

function resetRoomAfterLeave(room) {
    Object.assign(room, {
        phase: 'waiting',
        targetScore: null,
        currentPlayer: null,
        currentRoll: [],
        diceRemaining: 6,
        turnPoints: 0,
        winner: null,
        roundHistory: []
    })
}

function leaveCurrentRoom(socket) {
    const code = socketRoom[socket.id]
    if (!code) return
    delete socketRoom[socket.id]
    const room = rooms[code]
    if (!room) return

    const name = room.names[socket.id]
    room.players = room.players.filter(p => p !== socket.id)
    delete room.names[socket.id]
    delete room.scores[socket.id]
    socket.leave(code)

    if (room.players.length === 0) {
        delete rooms[code]
        broadcastPublicRooms()
        return
    }

    resetRoomAfterLeave(room)
    io.to(code).emit('playerLeft', { playerName: name, state: room })
    broadcastPublicRooms()
}

io.on('connection', (socket) => {
    socket.emit('welcome', { yourId: socket.id })
    socket.emit('publicRooms', publicRoomsList())

    socket.on('getPublicRooms', () => {
        socket.emit('publicRooms', publicRoomsList())
    })

    socket.on('createRoom', ({ playerName, roomName, isPublic }) => {
        const name = (playerName || '').trim().slice(0, 20)
        if (!name) return socket.emit('error', 'Enter thy name first')
        if (socketRoom[socket.id]) return

        const code = generateCode()
        const room = createRoomState(code, (roomName || '').trim().slice(0, 30) || `${name}'s Tavern`, !!isPublic)
        rooms[code] = room
        addPlayerToRoom(socket, room, name)

        socket.emit('roomJoined', { code, state: room })
        broadcastPublicRooms()
    })

    socket.on('joinRoom', ({ code, playerName }) => {
        const name = (playerName || '').trim().slice(0, 20)
        if (!name) return socket.emit('error', 'Enter thy name first')
        if (socketRoom[socket.id]) return

        const roomCode = (code || '').trim().toUpperCase()
        const room = rooms[roomCode]
        if (!room) return socket.emit('error', 'No such room exists')
        if (room.players.length >= 2) return socket.emit('error', 'That room is full')

        addPlayerToRoom(socket, room, name)

        socket.emit('roomJoined', { code: roomCode, state: room })
        io.to(roomCode).emit('gameState', room)
        broadcastPublicRooms()
    })

    socket.on('leaveRoom', () => {
        leaveCurrentRoom(socket)
        socket.emit('leftRoom')
    })

    socket.on('setTarget', (target) => {
        const room = getRoom(socket)
        if (!room) return
        if (room.phase !== 'setup') return
        if (!room.players.includes(socket.id)) return
        if (![2000, 3000, 5000].includes(target)) return
        room.targetScore = target
        room.currentPlayer = room.players[0]
        room.phase = 'playing'
        io.to(room.code).emit('gameState', room)
    })

    socket.on('roll', () => {
        const room = getRoom(socket)
        if (!room) return
        if (room.phase !== 'playing') return
        if (socket.id !== room.currentPlayer) return
        if (room.currentRoll.length > 0) return

        const roll = rollDice(room.diceRemaining)
        room.currentRoll = roll

        if (scoreSelection(roll) === 0) {
            const farkledId = socket.id
            room.turnPoints = 0
            room.diceRemaining = 6
            room.currentRoll = []
            room.currentPlayer = room.players.find(p => p !== farkledId)
            io.to(room.code).emit('farkle', { playerName: room.names[farkledId], roll, state: room })
        } else {
            io.to(room.code).emit('gameState', room)
        }
    })

    socket.on('keep', (indices) => {
        const room = getRoom(socket)
        if (!room) return
        if (room.phase !== 'playing') return
        if (socket.id !== room.currentPlayer) return
        if (room.currentRoll.length === 0) return
        if (!indices || indices.length === 0) return

        const valid = [...new Set(indices)].filter(i => i >= 0 && i < room.currentRoll.length)
        if (valid.length === 0) return

        const selected = valid.map(i => room.currentRoll[i])
        const score = scoreSelection(selected)
        if (score === 0) return socket.emit('error', 'Those dice do not score')

        room.turnPoints += score
        room.diceRemaining -= valid.length
        if (room.diceRemaining === 0) room.diceRemaining = 6
        room.currentRoll = []
        io.to(room.code).emit('gameState', room)
    })

    socket.on('bank', () => {
        const room = getRoom(socket)
        if (!room) return
        if (room.phase !== 'playing') return
        if (socket.id !== room.currentPlayer) return
        if (room.currentRoll.length > 0) return
        if (room.turnPoints === 0) return

        room.roundHistory.push({ player: socket.id, points: room.turnPoints })
        room.scores[socket.id] += room.turnPoints

        if (room.scores[socket.id] >= room.targetScore) {
            room.winner = socket.id
            room.phase = 'ended'
            io.to(room.code).emit('gameOver', { winnerName: room.names[socket.id], state: room })
            return
        }

        room.turnPoints = 0
        room.diceRemaining = 6
        room.currentPlayer = room.players.find(p => p !== socket.id)
        io.to(room.code).emit('gameState', room)
    })

    socket.on('disconnect', () => {
        leaveCurrentRoom(socket)
    })
})

const PORT = process.env.PORT || 3000
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`))
