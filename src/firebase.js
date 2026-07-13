import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

// TODO: Replace with your actual Firebase project config
// Project Name: magic-acting-game
const firebaseConfig = {
  apiKey: "AIzaSyAWHi-erKh986P9C8BrFYhjHiY0CTxfD7g",
  authDomain: "magic-acting-game.firebaseapp.com",
  databaseURL: "https://magic-acting-game-default-rtdb.firebaseio.com",
  projectId: "magic-acting-game",
  storageBucket: "magic-acting-game.firebasestorage.app",
  messagingSenderId: "527107985850",
  appId: "1:527107985850:web:7eeae2b74d85ace4d20d83",
  measurementId: "G-K9KCDV8WHP"
};

// Initialize Firebase
export const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
