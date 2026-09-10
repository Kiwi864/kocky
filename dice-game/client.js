const socket = io()
let myId = null
let gameState = null
let selectedIndices = []

socket.on('welcome', ({ yourId, state }) => {
    myId = yourId
    gameState = state
    render()
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
    document.getElementById('lobbyPage').style.display = 'none'
    document.getElementById('setupPage').style.display = 'none'
    document.getElementById('gamePage').style.display = 'none'
    const page = document.getElementById(id)
    page.style.display = id === 'gamePage' ? 'grid' : 'flex'
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
        showPage('lobbyPage')
        const joined = players.includes(myId)
        document.getElementById('joinForm').style.display = joined ? 'none' : 'flex'
        document.getElementById('waitingMsg').style.display = joined ? 'block' : 'none'
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
    document.getElementById('joinBtn').addEventListener('click', () => {
        const name = document.getElementById('username').value.trim()
        if (!name) return
        socket.emit('join', name)
    })

    document.getElementById('username').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') document.getElementById('joinBtn').click()
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
