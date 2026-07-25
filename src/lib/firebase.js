// Firebase, initialized once. We use the "compat" build here on purpose:
// it lets every component keep calling firebase.auth() / firebase.firestore()
// exactly like the original single-file version did, so migrating to this
// project structure didn't require rewriting every Firebase call site.
import firebase from "firebase/compat/app";
import "firebase/compat/auth";
import "firebase/compat/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAjrVHBu2IbbC3LrrYxDbNWfkUeuHVYdMc",
  authDomain: "tracktheedit.firebaseapp.com",
  projectId: "tracktheedit",
  storageBucket: "tracktheedit.firebasestorage.app",
  messagingSenderId: "986591263625",
  appId: "1:986591263625:web:0cd2bbd0b3f7dfcc593f58",
  measurementId: "G-B2BZNM4FED",
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

export default firebase;
