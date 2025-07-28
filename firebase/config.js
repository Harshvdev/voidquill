// src/firebase/config.js

// 1. Import the necessary functions from the Firebase SDKs
import { initializeApp } from "firebase/app";
import { getFirestore, serverTimestamp } from "firebase/firestore";
import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";

// 2. Your web app's Firebase configuration
// This pulls the values from your .env file.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_API_KEY,
  authDomain: import.meta.env.VITE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_APP_ID
};

// 3. Initialize Firebase and the required services
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// 4. Export the services and functions for use in other parts of your app
export {
  db,
  auth,
  serverTimestamp,
  signInAnonymously,
  onAuthStateChanged
};