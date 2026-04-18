# Chat App

A full-stack chat application with MySQL backend, user registration, and login.

## Setup

1. Install MySQL and create a database.

2. Run the schema.sql file to create tables:
   ```
   mysql -u root -p < db/schema.sql
   ```

3. If updating an existing database, run:
   ```
   ALTER TABLE users ADD COLUMN role ENUM('user', 'co-owner', 'owner') DEFAULT 'user';
   UPDATE users SET role = 'owner' WHERE username = 'Huseyn';
   ```

4. Update the database credentials in server.js if necessary.

5. Install dependencies:
   ```
   npm install
   ```

6. Start the server:
   ```
   npm start
   ```

7. Open http://localhost:3000 in your browser.

## Features

- User registration and login
- Real-time chat using Socket.io
- User roles: [User] (yellow), [Co-Owner] (blue), [Owner] (red)
- Commands: /promote <username>, /demote <username> (owner/co-owner only)
- Messages stored in MySQL database