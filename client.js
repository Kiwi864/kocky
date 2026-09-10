const socket = io()
let myId = null
let gameState = null
let selectedIndices = []
let currentRoomCode = null

socket.on('welcome', ({ yourId }) => {
    myId = yourId
})

socket.on('publicRooms', (rooms) => {
    renderPublicRooms(rooms)
})

socket.on('roomJoined', ({ code, state }) => {
    currentRoomCode = code
    gameState = state
    selectedIndices = []
    render()
})

socket.on('leftRoom', () => {
    currentRoomCode = null
    gameState = null
    selectedIndices = []
    showPage('menuPage')
    socket.emit('getPublicRooms')
})

socket.on('gameState', (state) => {
    gameState = state
    selectedIndices = []
    render()
})

socket.on('farkle', ({ playerName, roll, state }) => {
    gameState = state
    selectedIndices = []
    const isMe = myId && gameState.names[myId] === playerName
    showToast(
        isMe
            ? `Farkle! Thou rolled [${roll.join(', ')}] — turn lost!`
            : `${playerName} farkled on [${roll.join(', ')}]! Thy turn.`,
        'farkle'
    )
    render()
})

socket.on('gameOver', ({ winnerName, state }) => {
    gameState = state
    render()
})

socket.on('playerLeft', ({ playerName, state }) => {
    gameState = state
    selectedIndices = []
    showToast(`${playerName} hath fled the tavern. Game reset.`, 'warning')
    render()
})

socket.on('error', (msg) => {
    showToast(msg, 'error')
})

function showToast(msg, type = 'info') {
    const container = document.getElementById('toastContainer')
    const toast = document.createElement('div')
    toast.className = `toast toast-${type}`
    toast.textContent = msg
    container.appendChild(toast)
    requestAnimationFrame(() => toast.classList.add('visible'))
    setTimeout(() => {
        toast.classList.remove('visible')
        setTimeout(() => toast.remove(), 400)
    }, 3500)
}

function showPage(id) {
    document.getElementById('menuPage').style.display = 'none'
    document.getElementById('waitingPage').style.display = 'none'
    document.getElementById('setupPage').style.display = 'none'
    document.getElementById('gamePage').style.display = 'none'
    const page = document.getElementById(id)
    page.style.display = id === 'gamePage' ? 'grid' : 'flex'
}

function renderPublicRooms(rooms) {
    const list = document.getElementById('publicRoomsList')
    list.innerHTML = ''

    if (!rooms || rooms.length === 0) {
        const li = document.createElement('li')
        li.className = 'room-list-empty'
        li.textContent = 'No public lobbies open'
        list.appendChild(li)
        return
    }

    rooms.forEach((room) => {
        const li = document.createElement('li')
        li.className = 'room-list-item'
        li.innerHTML = `
            <span class="room-list-name">${escapeHtml(room.name)}</span>
            <span class="room-list-count">${room.playerCount}/2</span>
            <button data-code="${room.code}">Join</button>
        `
        li.querySelector('button').addEventListener('click', () => joinRoom(room.code))
        list.appendChild(li)
    })
}

function escapeHtml(str) {
    const div = document.createElement('div')
    div.textContent = str
    return div.innerHTML
}

function getPlayerName() {
    const name = document.getElementById('username').value.trim()
    if (!name) {
        showToast('Enter thy name first', 'warning')
        return null
    }
    return name
}

function joinRoom(code) {
    const playerName = getPlayerName()
    if (!playerName) return
    socket.emit('joinRoom', { code, playerName })
}

function render() {
    if (!gameState) return
    const {
        phase, players, names, scores, targetScore,
        currentPlayer, currentRoll, diceRemaining,
        turnPoints, winner, roundHistory
    } = gameState
    const isMyTurn = myId === currentPlayer

    if (phase === 'waiting') {
        showPage('waitingPage')
        document.getElementById('roomNameDisplay').textContent = gameState.name || ''
        document.getElementById('roomCodeDisplay').textContent = currentRoomCode ? `Code: ${currentRoomCode}` : ''
        return
    }

    if (phase === 'setup') {
        showPage('setupPage')
        const [p1, p2] = players
        document.getElementById('setupMsg').textContent =
            `${names[p1]} vs ${names[p2]} — choose a target:`
        return
    }

    if (phase === 'playing' || phase === 'ended') {
        showPage('gamePage')

        const [p1, p2] = players

        // Scoreboard
        document.getElementById('p1header').textContent = names[p1]
        document.getElementById('p2header').textContent = names[p2]
        document.getElementById('targetDisplay').textContent = `First to ${targetScore} points`

        const tbody = document.getElementById('scoreBody')
        tbody.innerHTML = ''
        roundHistory.forEach((round, i) => {
            const isP1 = round.player === p1
            const tr = document.createElement('tr')
            tr.innerHTML = `
                <td>${i + 1}</td>
                <td>${isP1 ? round.points : ''}</td>
                <td>${!isP1 ? round.points : ''}</td>
            `
            tbody.appendChild(tr)
        })

        document.getElementById('p1total').textContent = scores[p1]
        document.getElementById('p2total').textContent = scores[p2]

        if (phase === 'ended') {
            document.getElementById('turnMsg').textContent = ''
            document.getElementById('turnPointsMsg').textContent = ''
            document.getElementById('diceRemainingMsg').textContent = ''
            document.getElementById('diceArea').innerHTML = ''
            document.getElementById('rollBtn').style.display = 'none'
            document.getElementById('keepBtn').style.display = 'none'
            document.getElementById('bankBtn').style.display = 'none'
            const banner = document.getElementById('winnerBanner')
            banner.style.display = 'block'
            banner.textContent = `⚔ ${names[winner]} claims victory! ⚔`
            return
        }

        // Turn info
        document.getElementById('turnMsg').textContent =
            isMyTurn ? '⚔ Thy turn, warrior!' : `${names[currentPlayer]}'s turn`
        document.getElementById('turnPointsMsg').textContent =
            turnPoints > 0 ? `Turn points: ${turnPoints}` : ''
        document.getElementById('diceRemainingMsg').textContent =
            `Dice remaining: ${diceRemaining}`

        renderDice(currentRoll, isMyTurn)

        document.getElementById('rollBtn').style.display =
            (isMyTurn && currentRoll.length === 0) ? 'inline-block' : 'none'
        document.getElementById('keepBtn').style.display =
            (isMyTurn && currentRoll.length > 0) ? 'inline-block' : 'none'
        document.getElementById('bankBtn').style.display =
            (isMyTurn && currentRoll.length === 0 && turnPoints > 0) ? 'inline-block' : 'none'
    }
}

function renderDice(roll, isMyTurn) {
    const area = document.getElementById('diceArea')
    area.innerHTML = ''
    if (roll.length === 0) return

    roll.forEach((value, index) => {
        const die = document.createElement('div')
        die.className = 'die'
        die.textContent = value
        if (selectedIndices.includes(index)) die.classList.add('selected')
        if (!isMyTurn) {
            die.classList.add('inactive')
        } else {
            die.addEventListener('click', () => {
                if (selectedIndices.includes(index)) {
                    selectedIndices = selectedIndices.filter(i => i !== index)
                } else {
                    selectedIndices.push(index)
                }
                renderDice(roll, isMyTurn)
            })
        }
        area.appendChild(die)
    })
}

document.addEventListener('DOMContentLoaded', () => {
    socket.emit('getPublicRooms')

    document.getElementById('createBtn').addEventListener('click', () => {
        const playerName = getPlayerName()
        if (!playerName) return
        const roomName = document.getElementById('roomName').value.trim()
        const isPublic = document.querySelector('input[name="visibility"]:checked').value === 'public'
        socket.emit('createRoom', { playerName, roomName, isPublic })
    })

    document.getElementById('joinCodeBtn').addEventListener('click', () => {
        const code = document.getElementById('joinCode').value.trim()
        if (!code) return showToast('Enter a room code', 'warning')
        joinRoom(code)
    })

    document.getElementById('joinCode').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') document.getElementById('joinCodeBtn').click()
    })

    document.getElementById('leaveBtn').addEventListener('click', () => {
        socket.emit('leaveRoom')
    })

    document.getElementById('roomCodeDisplay').addEventListener('click', () => {
        if (!currentRoomCode) return
        navigator.clipboard?.writeText(currentRoomCode)
        showToast('Code copied to clipboard', 'info')
    })

    document.querySelectorAll('.targetBtn').forEach(btn => {
        btn.addEventListener('click', () => {
            socket.emit('setTarget', parseInt(btn.dataset.target))
        })
    })

    document.getElementById('rollBtn').addEventListener('click', () => {
        socket.emit('roll')
    })

    document.getElementById('keepBtn').addEventListener('click', () => {
        if (selectedIndices.length === 0) {
            showToast('Select at least one die first', 'warning')
            return
        }
        socket.emit('keep', selectedIndices)
    })

    document.getElementById('bankBtn').addEventListener('click', () => {
        socket.emit('bank')
    })
})
