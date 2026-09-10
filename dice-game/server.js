const express = require('express')
const http = require('http')
const { Server } = require('socket.io')

const app = express()
const server = http.createServer(app)
const io = new Server(server)

app.use(express.static('.'))

const state = {
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

io.on('connection', (socket) => {
    socket.emit('welcome', { yourId: socket.id, state })

    socket.on('join', (name) => {
        if (state.players.length >= 2) return socket.emit('error', 'Game is full')
        if (state.players.includes(socket.id)) return
        state.players.push(socket.id)
        state.names[socket.id] = name
        state.scores[socket.id] = 0
        if (state.players.length === 2) state.phase = 'setup'
        io.emit('gameState', state)
    })

    socket.on('setTarget', (target) => {
        if (state.phase !== 'setup') return
        if (!state.players.includes(socket.id)) return
        if (![2000, 3000, 5000].includes(target)) return
        state.targetScore = target
        state.currentPlayer = state.players[0]
        state.phase = 'playing'
        io.emit('gameState', state)
    })

    socket.on('roll', () => {
        if (state.phase !== 'playing') return
        if (socket.id !== state.currentPlayer) return
        if (state.currentRoll.length > 0) return

        const roll = rollDice(state.diceRemaining)
        state.currentRoll = roll

        if (scoreSelection(roll) === 0) {
            const farkledId = socket.id
            state.turnPoints = 0
            state.diceRemaining = 6
            state.currentRoll = []
            state.currentPlayer = state.players.find(p => p !== farkledId)
            io.emit('farkle', { playerName: state.names[farkledId], roll, state })
        } else {
            io.emit('gameState', state)
        }
    })

    socket.on('keep', (indices) => {
        if (state.phase !== 'playing') return
        if (socket.id !== state.currentPlayer) return
        if (state.currentRoll.length === 0) return
        if (!indices || indices.length === 0) return

        const valid = [...new Set(indices)].filter(i => i >= 0 && i < state.currentRoll.length)
        if (valid.length === 0) return

        const selected = valid.map(i => state.currentRoll[i])
        const score = scoreSelection(selected)
        if (score === 0) return socket.emit('error', 'Those dice do not score')

        state.turnPoints += score
        state.diceRemaining -= valid.length
        if (state.diceRemaining === 0) state.diceRemaining = 6
        state.currentRoll = []
        io.emit('gameState', state)
    })

    socket.on('bank', () => {
        if (state.phase !== 'playing') return
        if (socket.id !== state.currentPlayer) return
        if (state.currentRoll.length > 0) return
        if (state.turnPoints === 0) return

        state.roundHistory.push({ player: socket.id, points: state.turnPoints })
        state.scores[socket.id] += state.turnPoints

        if (state.scores[socket.id] >= state.targetScore) {
            state.winner = socket.id
            state.phase = 'ended'
            io.emit('gameOver', { winnerName: state.names[socket.id], state })
            return
        }

        state.turnPoints = 0
        state.diceRemaining = 6
        state.currentPlayer = state.players.find(p => p !== socket.id)
        io.emit('gameState', state)
    })

    socket.on('disconnect', () => {
        if (!state.players.includes(socket.id)) return
        const name = state.names[socket.id]
        state.players = state.players.filter(p => p !== socket.id)
        delete state.names[socket.id]
        delete state.scores[socket.id]
        Object.assign(state, {
            phase: 'waiting',
            targetScore: null,
            currentPlayer: null,
            currentRoll: [],
            diceRemaining: 6,
            turnPoints: 0,
            winner: null,
            roundHistory: []
        })
        io.emit('playerLeft', { playerName: name, state })
    })
})

server.listen(3000, () => console.log('Server running on http://localhost:3000'))
