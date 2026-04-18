const socket = io();
let currentUser = null;

document.getElementById('showRegister').addEventListener('click', (e) => {
  e.preventDefault();
  document.getElementById('auth').style.display = 'none';
  document.getElementById('register').style.display = 'block';
});

document.getElementById('showLogin').addEventListener('click', (e) => {
  e.preventDefault();
  document.getElementById('register').style.display = 'none';
  document.getElementById('auth').style.display = 'block';
});

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('loginUsername').value;
  const password = document.getElementById('loginPassword').value;

  const response = await fetch('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });

  const data = await response.json();
  if (response.ok) {
    currentUser = { id: data.userId, username };
    document.getElementById('auth').style.display = 'none';
    document.getElementById('chat').style.display = 'block';
    socket.emit('join', username);
  } else {
    alert(data.error);
  }
});

document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('registerUsername').value;
  const password = document.getElementById('registerPassword').value;

  const response = await fetch('/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });

  const data = await response.json();
  if (response.ok) {
    alert('Registration successful. Please login.');
    document.getElementById('register').style.display = 'none';
    document.getElementById('auth').style.display = 'block';
  } else {
    alert(data.error);
  }
});

document.getElementById('messageForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const message = document.getElementById('messageInput').value;
  socket.emit('sendMessage', { message, userId: currentUser.id });
  document.getElementById('messageInput').value = '';
});

socket.on('message', (data) => {
  const messages = document.getElementById('messages');
  const messageElement = document.createElement('div');
  messageElement.className = 'message';
  messageElement.textContent = `${data.username}: ${data.message}`;
  messages.appendChild(messageElement);
  messages.scrollTop = messages.scrollHeight;
});

socket.on('userJoined', (username) => {
  const messages = document.getElementById('messages');
  const messageElement = document.createElement('div');
  messageElement.className = 'userJoined';
  messageElement.textContent = `${username} joined the chat`;
  messages.appendChild(messageElement);
});

socket.on('userLeft', (username) => {
  const messages = document.getElementById('messages');
  const messageElement = document.createElement('div');
  messageElement.className = 'userLeft';
  messageElement.textContent = `${username} left the chat`;
  messages.appendChild(messageElement);
});