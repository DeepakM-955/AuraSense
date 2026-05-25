// ============================================
// AuraSense — Firebase Configuration
// ============================================
// IMPORTANT: Replace the placeholder values below
// with your actual Firebase project credentials.
// You can find these in Firebase Console → Project Settings → General → Your apps → Web app.

const firebaseConfig = {
  apiKey: "AIzaSyDfGiAOcvYRexPqouDtltXRtifE3DPc4h8",
  authDomain: "aurasense-80841.firebaseapp.com",
  databaseURL: "https://aurasense-80841-default-rtdb.firebaseio.com",
  projectId: "aurasense-80841",
  storageBucket: "aurasense-80841.firebasestorage.app",
  messagingSenderId: "852977024825",
  appId: "1:852977024825:web:5e10758dd7a1d4e0b6f2e8",
  measurementId: "G-WXX9C6XDYS"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Export services
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();
const rtdb = firebase.database();

// Google Auth Provider
const googleProvider = new firebase.auth.GoogleAuthProvider();
