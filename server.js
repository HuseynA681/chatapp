const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mysql = require('mysql2');
const bcrypt = require('bcrypt');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// MySQL connection pool
const db = mysql.createPool({
  host: process.env.DB_HOST || 'mysql5045.site4now.net',
  user: process.env.DB_USER || 'ac838c_dbhus',
  password: process.env.DB_PASSWORD || 'Azerbaijan1918',
  database: process.env.DB_NAME || 'db_ac838c_dbhus',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 60000,
  keepAliveInitialDelay: 0
});

console.log('Connected to MySQL');

// Handle pool errors
db.on('error', (err) => {
  console.error('MySQL pool error:', err);
});

// Register endpoint
app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  try {
    // Check if user exists
    const [rows] = await db.promise().query('SELECT id FROM users WHERE username = ?', [username]);
    if (rows.length > 0) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user
    const role = username === 'Huseyn' ? 'owner' : 'user';
    const [result] = await db.promise().query('INSERT INTO users (username, role) VALUES (?, ?)', [username, role]);
    const userId = result.insertId;

    // Insert password
    await db.promise().query('INSERT INTO passwords (user_id, password) VALUES (?, ?)', [userId, hashedPassword]);

    res.json({ message: 'User registered successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login endpoint
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  try {
    // Get user
    const [rows] = await db.promise().query('SELECT u.id, u.role, p.password FROM users u JOIN passwords p ON u.id = p.user_id WHERE u.username = ?', [username]);
    if (rows.length === 0) {
      return res.status(400).json({ error: 'User not found. Please register first.' });
    }

    const user = rows[0];
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(400).json({ error: 'Invalid password' });
    }

    res.json({ message: 'Login successful', userId: user.id, username, role: user.role });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Socket.io for chat
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join', (data) => {
    socket.username = data.username;
    socket.role = data.role;
    socket.join('chat');
    io.to('chat').emit('userJoined', { username: data.username, role: data.role });
  });

  socket.on('sendMessage', async (data) => {
    const { message, userId } = data;
    let finalMessage = message;
    let isCommand = false;

    if (message.startsWith('/')) {
      const parts = message.split(' ');
      const command = parts[0];
      const targetUsername = parts[1];

      if ((command === '/promote' || command === '/demote') && targetUsername) {
        if (socket.role === 'owner' || socket.role === 'co-owner') {
          try {
            // Get target user
            const [rows] = await db.promise().query('SELECT id, role FROM users WHERE username = ?', [targetUsername]);
            if (rows.length > 0) {
              const target = rows[0];
              let newRole = target.role;

              if (command === '/promote') {
                if (socket.role === 'owner') {
                  if (target.role === 'user') newRole = 'co-owner';
                  else if (target.role === 'co-owner') newRole = 'owner';
                } else if (socket.role === 'co-owner' && target.role === 'user') {
                  newRole = 'co-owner';
                }
              } else if (command === '/demote') {
                if (socket.role === 'owner') {
                  if (target.role === 'co-owner') newRole = 'user';
                  else if (target.role === 'owner') newRole = 'co-owner'; // can't demote owner
                } else if (socket.role === 'co-owner' && target.role === 'co-owner') {
                  newRole = 'user';
                }
              }

              if (newRole !== target.role) {
                await db.promise().query('UPDATE users SET role = ? WHERE id = ?', [newRole, target.id]);
                finalMessage = `${socket.username} ${command.slice(1)}d ${targetUsername} to ${newRole}`;
                isCommand = true;
                // Notify the target user if online
                io.to('chat').emit('roleUpdate', { username: targetUsername, newRole });
              } else {
                finalMessage = `Cannot ${command.slice(1)} ${targetUsername}`;
                isCommand = true;
              }
            } else {
              finalMessage = `User ${targetUsername} not found`;
              isCommand = true;
            }
          } catch (error) {
            console.error(error);
            finalMessage = 'Command failed';
            isCommand = true;
          }
        } else {
          finalMessage = 'You do not have permission to use this command';
          isCommand = true;
        }
      }
    }

    try {
      if (!isCommand || finalMessage !== message) {
        await db.promise().query('INSERT INTO messages (user_id, message) VALUES (?, ?)', [userId, finalMessage]);
      }
      io.to('chat').emit('message', { username: socket.username, message: finalMessage, role: socket.role, isCommand });
    } catch (error) {
      console.error(error);
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    io.to('chat').emit('userLeft', { username: socket.username, role: socket.role });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});