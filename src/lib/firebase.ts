import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Standard import for the config file
// If this file is missing in your local environment, create it or use environment variables
import localConfig from '@/firebase-applet-config.json';

// Try to load from environment variables first (standard for hosting)
// These are defined in vite.config.ts
const envConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
  firestoreDatabaseId: process.env.FIREBASE_DATABASE_ID || "(default)"
};

// Default config to prevent crashing if everything is missing
let firebaseConfig: any = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: "",
  firestoreDatabaseId: "(default)"
};

// Priority: 1. Environment Variables, 2. Local Config File
if (envConfig.apiKey && envConfig.apiKey !== "undefined" && envConfig.apiKey !== "") {
  firebaseConfig = { ...firebaseConfig, ...envConfig };
} else if (localConfig && localConfig.apiKey) {
  firebaseConfig = { ...firebaseConfig, ...localConfig };
}

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
