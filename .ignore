// firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getDatabase, ref, set, onValue, push, remove } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";

const firebaseConfig = {
  apiKey: "Ws4UNWEftn4qjhA5ef1KZD1wAkKKPw9rLShwQ2Cn", // Need to grab this from console
  authDomain: "samflow-b7814.firebaseapp.com", // Automatically generated
  databaseURL: "https://samflow-b7814-default-rtdb.asia-southeast1.firebasedatabase.app/", // Your URL!
  projectId: "samflow-b7814", // Your Project ID
  storageBucket: "samflow-b7814.firebasestorage.app", // Automatically generated
  messagingSenderId: "3706516340", // Need to grab this from console
  appId: "1:3706516340:web:def4fe3041ed74f1a1b221", // Need to grab this from console
  measurementId: "G-2CZ8675M33"
};

// Initialize Firebase services
const app = initializeApp(firebaseConfig);
const database = getDatabase(app);

export { database, ref, set, onValue, push, remove };
