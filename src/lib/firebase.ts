import { initializeApp } from "firebase/app";
import { 
  getAuth, 
  GoogleAuthProvider, 
  RecaptchaVerifier,
  signInWithPhoneNumber,
  signOut
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  projectId: "upheld-habitat-mv8b6",
  appId: "1:482995311819:web:c092fb92871a0ecec8774e",
  apiKey: "AIzaSyB_Qi94cJHM7GFhVl-73pIhx8FzH021y04",
  authDomain: "upheld-habitat-mv8b6.firebaseapp.com",
  storageBucket: "upheld-habitat-mv8b6.firebasestorage.app",
  messagingSenderId: "482995311819",
};

// Initialize Firebase App
const app = initializeApp(firebaseConfig);

// Initialize Firebase Services
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

export { signOut, RecaptchaVerifier, signInWithPhoneNumber };
