const express = require("express");
const path = require("path");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");

// --- Firebase Setup --- //
const { initializeApp } = require("firebase/app");
const { getDatabase, ref, get, set } = require("firebase/database");

// Your Firebase configuration from your Firebase console
const firebaseConfig = {
  apiKey: "AIzaSyByP51EtTT7FaGjlDueqPo7WlOcKujlodk",
  authDomain: "gamemeetup-712d1.firebaseapp.com",
  databaseURL: "https://gamemeetup-712d1-default-rtdb.firebaseio.com",
  projectId: "gamemeetup-712d1",
  storageBucket: "gamemeetup-712d1.firebasestorage.app",
  messagingSenderId: "888224659299",
  appId: "1:888224659299:web:a8f01ec205e380b15c4556",
  measurementId: "G-8N0SEYH6BH",
};

// Initialize Firebase
const firebaseApp = initializeApp(firebaseConfig);
const database = getDatabase(firebaseApp);

// --- Express & Socket.IO Setup --- //
const app = express();

// Enable CORS for development
app.use(cors());

// Serve static files from the "public" folder
app.use(express.static(path.join(__dirname, "..", "public")));

// Create an HTTP server using Express
const server = http.createServer(app);

// Setup Socket.IO with CORS enabled
const io = socketIo(server, {
  cors: {
    origin: "*", // Allow all origins (for development)
  },
});

// Listen for socket connections
io.on("connection", (socket) => {
  // When a user joins a room, they send roomId and username
  socket.on("join-room", async ({ roomId, username }) => {
    socket.username = username;
    socket.join(roomId);
    console.log(`${username} joined room: ${roomId}`);

    const roomRef = ref(database, `rooms/${roomId}`);

    try {
      const snapshot = await get(roomRef);
      if (snapshot.exists()) {
        let roomData = snapshot.val();
        if (!roomData.participants) {
          roomData.participants = [];
        }
        roomData.participants.push({ id: socket.id, username });
        await set(roomRef, roomData);
        console.log(`User ${username} added to existing room in Firebase.`);
      } else {
        const newRoomData = {
          host: username,
          participants: [{ id: socket.id, username }],
          createdAt: Date.now(),
        };
        await set(roomRef, newRoomData);
        console.log(
          `Room ${roomId} created in Firebase with host ${username}.`
        );
      }

      // Get updated room data and send the new user a list of existing participants
      const updatedSnapshot = await get(roomRef);
      if (updatedSnapshot.exists()) {
        const updatedRoomData = updatedSnapshot.val();
        // Filter out the new user from the list for "all-users"
        const existingUsers = updatedRoomData.participants.filter(
          (p) => p.id !== socket.id
        );
        socket.emit("all-users", existingUsers);
        // Also broadcast the new user's join to everyone else
        socket.to(roomId).emit("user-joined", { id: socket.id, username });
        // Optionally, emit a room update to everyone
        io.in(roomId).emit("room-updated", updatedRoomData);
      }
    } catch (error) {
      console.error("Firebase error:", error);
    }

    // Relay WebRTC signaling messages between users
    socket.on("signal", (data) => {
      io.to(data.to).emit("signal", { from: socket.id, signal: data.signal });
    });

    // When the user disconnects, update Firebase and notify others in the room
    socket.on("disconnect", async () => {
      console.log(`User ${socket.username || socket.id} disconnected`);
      socket.to(roomId).emit("user-left", socket.id);

      try {
        const snapshot = await get(roomRef);
        if (snapshot.exists()) {
          let roomData = snapshot.val();
          if (roomData.participants) {
            roomData.participants = roomData.participants.filter(
              (p) => p.id !== socket.id
            );
            await set(roomRef, roomData);
            console.log(
              `User ${username} removed from room ${roomId} in Firebase.`
            );

            // Emit updated room data on disconnect
            const updatedSnapshot = await get(roomRef);
            if (updatedSnapshot.exists()) {
              const updatedRoomData = updatedSnapshot.val();
              io.in(roomId).emit("room-updated", updatedRoomData);
            }
          }
        }
      } catch (error) {
        console.error("Error updating Firebase on disconnect:", error);
      }
    });
  });
});

// Start the server on port 5000
server.listen(5000, () => {
  console.log("Server running on http://localhost:5000");
});
