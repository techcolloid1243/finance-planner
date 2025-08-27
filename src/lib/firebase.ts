import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCTGwJ817WR_WIeQNyay931D-3JngMyfCo",
  authDomain: "financeplanner-c386f.firebaseapp.com",
  projectId: "financeplanner-c386f",
  storageBucket: "financeplanner-c386f.firebasestorage.app",
  messagingSenderId: "524972945825",
  appId: "1:524972945825:web:17d4b443686dc7386c5be0",
  measurementId: "G-DS0XL1PS39",
};

let app: FirebaseApp;
if (!getApps().length) {
  app = initializeApp(firebaseConfig);
} else {
  app = getApps()[0]!;
}

export const auth: Auth = getAuth(app);
export const db: Firestore = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();


