
import { createClient } from "redis";

let DATA: any = {};
let timer: NodeJS.Timeout | false = false;
let Strategy: any[] =[];

// create redis listener
const redisClient = createClient({
    url: process.env.REDIS_HOST,
    password: process.env.REDIS_PASS
});

//listen to messages from parent process
process.on("message", async (data: any) => {
    if (data.init) {
        await initStrategy(data);
    } else {

    }
});

// initialize strategy
async function initStrategy(data: any) {
    DATA = data;
    if (timer) { 
        clearInterval(timer);
        timer = false;
    }
    if (data.persist) {
        for (let i = 0; i < Strategy.length; i++) {
            Strategy[i].stop();
            delete Strategy[i];
        }
        runStrategy();
    }
    else timer = setInterval(runStrategy, data.interval || 1000);
}

// run strategy
async function runStrategy() {
    if (DATA.persist) {
        let Algorithm: any = await import(`./algorithms/${DATA.algorithm}`);
        Algorithm.start(DATA, redisClient);
        Strategy.push(Algorithm);
    } else {
        let trigger: boolean = true;
        DATA.algorithm.forEach(async (algorithm: any) => { 
            let Algorithm: any = await import(`./algorithms/${algorithm}`);
            let result: boolean = Algorithm.start(DATA, redisClient);
            if (!result) { 
                trigger = false;
                return;
            }
        });
        if (trigger) {
            const { library, func, data } = DATA.trigger;
            const Trigger = await import(`./lib/${library}`);
            Trigger[func](data);
        }
    }
}
