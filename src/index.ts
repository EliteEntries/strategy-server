import { config } from "dotenv";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { credential } from "firebase-admin";
import { fork } from "child_process";

//initialize dotenv
config();

// initialize firebase
const firebaseApp = initializeApp({ 
    credential: credential.cert(
        JSON.parse(process.env.FIREBASE_CONFIG as string)
    ),
});
const db = getFirestore();

let Strategies: any = {};

(async function() {
    //get users
    const users = await db.collection("strategies").get();

    users.forEach(async (user) => {
        //get strategies
        const strategies = await db.collection(`users/${user.id}/strategies`).get();

        strategies.forEach(async (strategy) => { 
            db.doc(`users/${user.id}/strategies/${strategy.id}`).onSnapshot(async (doc) => {
                if (Strategies[strategy.id]) {
                    Strategies[strategy.id].kill("SIGINT")
                    delete Strategies[strategy.id]
                }
                const data = doc.data();
                if (data?.active) startStrategy(data, true);
            });
        });

    });
})()

async function startStrategy(data: any,  init: boolean)  {
    Strategies[data.id] = fork("strategy.js");
    if(init) data.init = true;
    Strategies[data.id].send(data);
}

function createStrategy(data: any) {
    db.doc(`users/${data.userID}/strategies/${data.id}`).set(data);
    if (data.active) startStrategy(data, true);
}

function pauseStrategy(data: any) {
    db.doc(`users/${data.userID}/strategies/${data.id}`)
        .update({active: false});
    if (Strategies[data.id]) Strategies[data.id].kill('SIGINT');
    delete Strategies[data.id];
}

function editStrategy (data:any) {
    db.doc(`users/${data.userID}/strategies/${data.id}`)
        .update(data);
    if (data.active) {
        data.init = true;
        Strategies[data.id].send(data);
    }
}