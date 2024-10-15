const snarkjs = require("snarkjs");
const fs = require("fs");
const { string_to_curve, message_to_professor_key, random_keys } = require("../boneh-encode/hash_to_curve");
const { vkey_serialize, vkey_prepared_serialize, proof_serialize, public_input_serialize, proof_serialize_by_parts } = require("../ark-serializer/pkg_node");
require('dotenv').config();
const { exit } = require("process");

const { AptosConfig, Aptos, Account, Network, Ed25519PrivateKey, U64, MoveVector, AccountAddress } = require('@aptos-labs/ts-sdk');
const { addr_to_bigint, utf8_hex_to_int, fetchGraphQL, paddedHex } = require("./helpers");

// Load environment variables
const privKey = process.env.PRIVATE_KEY;

// Get the network from command-line arguments
const args = process.argv.slice(2); // Remove the first two default arguments
let networkArg = args[0]; // The first argument is expected to be 0 or 1, or it could be undefined

// Default to "testnet" if no argument is provided
let network;

if (networkArg === undefined) {
    network = Network.TESTNET;
    console.log('No network argument provided, defaulting to testnet.');
} else if (networkArg === '0') {
    network = Network.TESTNET;
    console.log('Network set to testnet.');
} else if (networkArg === '1') {
    network = Network.MAINNET;
    console.log('Network set to mainnet.');
} else if (Network[networkArg.toUpperCase()]) {
    // Support "mainnet" or "testnet" as direct input as well
    network = Network[networkArg.toUpperCase()];
    console.log(`Network set to ${networkArg}.`);
} else {
    console.log(`Invalid network argument: ${networkArg}. Please provide "0", "1", "mainnet", or "testnet".`);
    process.exit(1); // Exit with an error
}
const net = (network == Network.TESTNET) ? 'testnet' : 'mainnet';

// Initialize Aptos config with the selected network
const config = new AptosConfig({ network });
console.log(`Aptos client initialized for ${networkArg || 'testnet'}`);

// Initialize Aptos client and account
const aptos = new Aptos(config);
const privateKey = new Ed25519PrivateKey(privKey);
const account = Account.fromPrivateKey({ privateKey });

//Define the correct filenames for the ids of objects depending on MAINNET vs TESTNET
const game_id_file = network==Network.TESTNET ? 'game.id' : 'game.id_mainnet';
const profiles_id_file = network==Network.TESTNET ? 'profiles.id' : 'profiles.id_mainnet';
const answers_id_file = network==Network.TESTNET ? 'answers.id' : 'answers.id_mainnet';
const quest_ids_file = network==Network.TESTNET ? 'quest.ids' : 'quest.ids_mainnet';

//Please write verifier_pkg id in package.id text file. Notice it is automatically done when deployed with deploy.js
const verifier_pkg = fs.readFileSync('package.id', 'utf8').trim() + "::verifier";
console.log(verifier_pkg);

//!!Please notice that it must be kept secret!!
//In production this oracle code runs on a secure server
//Which only professor - key holder - can access
//Key is a random number less than cyclic subgroup order 2736030358979909402780800718157159386076813972158567259200215660948447373041
const questions = [
    "In which programming language are smart contracts on Aptos written? [[OPTIONS]]: A) Solidity, B) Rust, C) Move, D) Python",
    "Which of the following describes Aptos' approach to transaction finality? [[OPTIONS]]: A) Delayed finality, B) Real-time finality, C) Instant but reversible finality, D) Finality only after block confirmation",
    "What is the primary benefit of Aptos' parallel transaction processing? [[OPTIONS]]: A) Reduced transaction fees, B) Higher transaction throughput, C) Improved security, D) Increased decentralization",
    "Aptos blockchain was launched in which year? [[OPTIONS]]: A) 2020, B) 2021, C) 2022, D) 2023",
    "What is the main function of validators in the Aptos network? [[OPTIONS]]: A) To mine tokens, B) To process and validate transactions, C) To develop decentralized applications (dApps), D) To store private keys",
    "Aptos was built with the focus of supporting which of the following? [[OPTIONS]]: A) Centralized finance, B) Decentralized finance (DeFi) and scalable dApps, C) Cloud storage solutions, D) Private blockchain solutions",
    "What is a key feature of the Move programming language used in Aptos? [[OPTIONS]]: A) It is based on Java, B) It enables formal verification of smart contracts, C) It is only used for private blockchains, D) It is primarily for off-chain data processing",
    "What is the primary use case of Aptos' token (APT)? [[OPTIONS]]: A) Governance and transaction fees, B) Storing data off-chain, C) Creating smart contracts only, D) Mining rewards",
    "How does Aptos achieve network scalability? [[OPTIONS]]: A) By increasing block size, B) By using sharding, C) Through parallel transaction execution, D) By reducing the number of validators",
    "What differentiates Aptos' storage system from other blockchains? [[OPTIONS]]: A) Use of a hierarchical storage model, B) Use of centralized data centers, C) A blockchain without storage, D) Storing data directly in nodes",
    "Which of the following is a design goal of the Aptos blockchain? [[OPTIONS]]: A) Low energy consumption, B) Building a fully decentralized exchange, C) Instantaneous finality and minimal fees, D) Supporting only financial applications"
];

const right_answers = [
    "C", // Correct answer for Question 1
    "B", // Correct answer for Question 2
    "B", // Correct answer for Question 3
    "C", // Correct answer for Question 4
    "B", // Correct answer for Question 5
    "B", // Correct answer for Question 6
    "B", // Correct answer for Question 7
    "A", // Correct answer for Question 8
    "C", // Correct answer for Question 9
    "A", // Correct answer for Question 10
    "C"  // Correct answer for Question 11
];

const P_xys_and_questions = [];

// console.log({new_keys: random_keys(right_answers.length)})
// exit()

//In production keys must be hidden in an env variable as well as right answers must obviously be hidden
const professor_keys =
    ["1584561490597234433444721371246996260316395925710778034972022929403589928560", "1410523144184515777705721561525132755984757303790778555698000198872570973948", "2211933601623746611877623626873082931036517988692641262731707744872542102186", "1522596334424819636784622426810666362696836890847847151062537141929370205291", "209330872829481859569795846101062234955973291048986126021494216656963038797", "2349895726214586051357600667715319630797313624396531540458161051149774098858", "780123089888020003087146613328142767205283238274756800514815288874580637612", "1560514486413613444052071663845660984464173894650740924867363336655922953416", "2472648307804323050578394844362124582754807480943942341280966472739176106294", "1306979738630964261343556470111870705700372528619825035958764397416544966797", "1851659862352020081593121292647193772176362222589488194749815741671376983728"];
console.log({ professor_keys });

//I want to prepare elliptic-curve-point encoding for each answer 
for (let index = 0; index < questions.length; index++) {
    const question = questions[index];
    const right_answer = right_answers[index];
    const professor_key = professor_keys[index];
    const { xx: P_x, yy: P_y } = string_to_curve(right_answer);
    P_xys_and_questions.push({ question, P_x, P_y, professor_key });
}

async function prepare(P_x, P_y, professor_key) {
    //Generates ZKP proofs to upload the quest to the contract
    //Now, ZKP makes sure that the answer point on EC, and the key, match the commitment and the point multiplied by key
    const addr = account.accountAddress.bcsToHex().toString();
    console.log({ addr })
    const addr_for_proof = addr_to_bigint(addr).toString();
    console.log(addr_for_proof);

    const { proof: proof_upload_quest, publicSignals: publicSignals_upload_quest } = await snarkjs.groth16.fullProve({ address: addr_for_proof, a: professor_key, P_x, P_y }, "compiled_circuits/commit_main.wasm", "compiled_circuits/commit_main.groth16.zkey");
    console.log({ P_x, P_y, proof_upload_quest: JSON.stringify(proof_upload_quest), publicSignals_upload_quest })

    return { addr, addr_for_proof, proof_upload_quest, publicSignals_upload_quest }
}

async function create_game() {

    //Prepare the Move contract txn, and submit new game crreation call
    const rawTxn = await aptos.transaction.build.simple({
        sender: account.accountAddress, data: {
            function: verifier_pkg + '::professor_create_game',
            functionArguments: [],
        }
    })
    const senderAuthenticator = await aptos.transaction.sign({ signer: account, transaction: rawTxn });
    const txnResult = await aptos.transaction.submit.simple({
        transaction: rawTxn,
        senderAuthenticator,

    });
    console.log(`Transaction submitted with hash: ${txnResult.hash}`);

    // Wait for transaction confirmation
    const txnDetails = await aptos.waitForTransaction({ transactionHash: txnResult.hash });
    console.log(txnDetails);

    const createdObjects = txnDetails.events.filter(event => event.type === verifier_pkg + "::GameCreatedEvent");
    console.log(createdObjects[0].data)
    const game_id = createdObjects[0].data.game_number_in_registry;
    console.log({ game_id });

    //Fetch the current GameRegistry to get the game, answers, and profiles info
    const results = await aptos.getAccountResource({
        accountAddress: account.accountAddress,
        resourceType: verifier_pkg + "::GameRegistry",
        minimumLedgerVersion: BigInt(txnDetails.version)
    })
    console.log(results.games[game_id - 1])

    const game_info = results.games[game_id - 1];
    const answers_id = game_info.answers.handle;
    const profiles_id = game_info.profiles.handle;

    //Save the addresses of profiles table, answers table
    //And just the game id number inside of the game registry
    fs.writeFileSync(game_id_file, game_id, (err) => {
        if (err) throw err;
        console.log('Game ID saved to file!');
    });

    fs.writeFileSync(profiles_id_file, profiles_id, (err) => {
        if (err) throw err;
        console.log('Game ID saved to file!');
    });

    fs.writeFileSync(answers_id_file, answers_id, (err) => {
        if (err) throw err;
        console.log('Game ID saved to file!');
    });

    return game_id;
}

function hex_to_movevector(hexString) {
    // Remove any leading "0x" from the hex string if present
    if (hexString.startsWith("0x")) {
        hexString = hexString.slice(2);
    }

    // Ensure the hex string has an even length
    if (hexString.length % 2 !== 0) {
        throw new Error("Invalid hex string");
    }

    // Create a Uint8Array with length half of the hex string
    const byteArray = new Uint8Array(hexString.length / 2);

    // Convert each pair of hex characters to a byte
    for (let i = 0; i < byteArray.length; i++) {
        byteArray[i] = parseInt(hexString.substr(i * 2, 2), 16);
    }
    return MoveVector.U8(byteArray);
}

//TODO: Batch all quest uploads in one programmable transaction
//Uploads the question to the contract by running the ZKP circuits
//And providing proofs to the Aptos contract
async function upload_quest(game_id, P_xy_and_question) {
    const { question, P_x, P_y, professor_key } = P_xy_and_question
    const { addr, addr_for_proof, proof_upload_quest, publicSignals_upload_quest } = await prepare(P_x, P_y, professor_key)

    //Now serialzie with my ark-serialize the proof
    const { proof_a, proof_b, proof_c } = JSON.parse(proof_serialize_by_parts(JSON.stringify(proof_upload_quest)));
    console.log({ proof_a, proof_b, proof_c })

    //Now serialzie with my ark-serialize the public inputs    
    const signals = publicSignals_upload_quest.map((input) => public_input_serialize(input))
    console.log({ signals })

    const [professor_k_hash, kP_x, kP_y, _] = signals
    console.log(professor_k_hash, kP_x, kP_y);

    //Check proof
    const vKey = JSON.parse(fs.readFileSync("compiled_circuits/commit_main.groth16.vkey.json"));
    const res = await snarkjs.groth16.verify(vKey, publicSignals_upload_quest, proof_upload_quest);
    if (res === true) {
        console.log("Verification OK");
    } else {
        console.log("Invalid proof");
    }

    //Fill in all the proofs, game_id, and addresses, question text to the Txn
    const rawTxn = await aptos.transaction.build.simple({
        sender: account.accountAddress, data: {
            // All transactions on Aptos are implemented via smart contracts.
            function: verifier_pkg + '::professor_create_quest',
            functionArguments: [
                new U64(game_id - 1),
                new U64(1),
                "data: image blob placeholder for now",
                question,
                hex_to_movevector(proof_a),
                hex_to_movevector(proof_b),
                hex_to_movevector(proof_c),
                hex_to_movevector(professor_k_hash),
                hex_to_movevector(kP_x),
                hex_to_movevector(kP_y),
            ],
        }
    })

    //Sign and submit the Txn
    const senderAuthenticator = await aptos.transaction.sign({ signer: account, transaction: rawTxn });
    const txnResult = await aptos.transaction.submit.simple({
        transaction: rawTxn,
        senderAuthenticator,
    });
    console.log(`Transaction submitted with hash: ${txnResult.hash}`);

    // Wait for the transaction confirmation
    const txnDetails = await aptos.waitForTransaction({ transactionHash: txnResult.hash });
    console.log(txnDetails);
}

async function process_answer(quest_id, game_id, student_address, student_aH_x, student_aH_y, P_xy_and_question) {
    const { question, P_x, P_y, professor_key } = P_xy_and_question;
    console.log({ P_xy_and_question });

    const { addr, addr_for_proof, proof_upload_quest, publicSignals_upload_quest } = await prepare(P_x, P_y, professor_key);
    console.log({ student_address, student_aH_x, student_aH_y });

    const professor_k_hash_int = publicSignals_upload_quest[0];

    //Convert address, student_aH_x, student_aH_y to decimal numbers represented as a string
    //const student_address_int = addr_to_bigint(student_address).toString()
    const student_aH_x_int = utf8_hex_to_int(student_aH_x).toString()
    const student_aH_y_int = utf8_hex_to_int(student_aH_y).toString()

    console.log({ address: addr_for_proof, k: professor_key, hash_k: professor_k_hash_int, aH_x: student_aH_x_int, aH_y: student_aH_y_int });


    //BEGIN: Generate unlock proof of professor multiplied student point with her same key 
    const { proof: proof_unlock, publicSignals: publicSignals_unlock } = await snarkjs.groth16.fullProve({ address: addr_for_proof, k: professor_key, hash_k: professor_k_hash_int, aH_x: student_aH_x_int, aH_y: student_aH_y_int }, "compiled_circuits/unlock_main.wasm", "compiled_circuits/unlock_main.groth16.zkey");
    console.log({ proof: JSON.stringify(proof_unlock), publicSignals_unlock })

    const { proof_a, proof_b, proof_c } = JSON.parse(proof_serialize_by_parts(JSON.stringify(proof_unlock)));
    // const proof_unlock_serialized = proof_serialize(JSON.stringify(proof_unlock));
    // console.log({ proof_unlock_serialized })

    //Now serialzie with my ark-serialize the public inputs    
    const signals_unlock = publicSignals_unlock.map((input) => public_input_serialize(input))
    console.log({ signals_unlock })

    const [kaH_x, kaH_y, , ,] = signals_unlock
    console.log({ kaH_x, kaH_y });
    //END: Generate unlock proof of professor multiplied student point with her same key//

    // //And send it to the contract for verification
    // public entry fun professor_score_answer(user: &signer, quest_number: u64, game_number: u64, student: address, 
    //     proof_a:vector<u8>, proof_b:vector<u8>, proof_c:vector<u8>,
    //     professor_out_kaH_x: vector<u8>, professor_out_kaH_y: vector<u8>) 
    const rawTxn = await aptos.transaction.build.simple({
        sender: account.accountAddress, data: {
            // All transactions on Aptos are implemented via smart contracts.
            function: verifier_pkg + '::professor_score_answer',
            functionArguments: [
                new U64(quest_id),
                new U64(parseInt(game_id, 10) - 1), //subtract one or not?
                new AccountAddress(new Uint8Array((student_address).slice(2).match(/.{1,2}/g).map(byte => parseInt(byte, 16)))),
                hex_to_movevector(proof_a),
                hex_to_movevector(proof_b),
                hex_to_movevector(proof_c),
                hex_to_movevector(kaH_x),
                hex_to_movevector(kaH_y),
            ],
        }
    })
    const senderAuthenticator = await aptos.transaction.sign({ signer: account, transaction: rawTxn });

    const txnResult = await aptos.transaction.submit.simple({
        transaction: rawTxn,
        senderAuthenticator,
    });
    console.log(`Transaction submitted with hash: ${txnResult.hash}`);
    const txnDetails = await aptos.waitForTransaction({ transactionHash: txnResult.hash });
    console.log(txnDetails)
}

//This function just takes a single question attempt from all
//And tries to verify it with a proof on-chain
async function process_attempt(game_id, data, P_xys_and_questions) {
    const { decoded_key, decoded_value } = data[0];
    let { student_address = '', student_aH_x = '', student_aH_y = '', quest = '' } = decoded_value;
    student_address = paddedHex(student_address);
    const quest_id = parseInt(quest, 10);
    console.log({ student_address, student_aH_x, student_aH_y, quest_id });

    const P_xy_and_question = P_xys_and_questions[quest_id];

    if (student_address != '') await process_answer(quest_id, game_id, student_address, student_aH_x, student_aH_y,
        P_xy_and_question);
}

//This is a precise Aptos GraphQL query to get the latest attemps from the answers table
const operationsDoc = `
    query MyQuery {
      table_items(
        order_by: [{decoded_key: asc}, {transaction_version: desc}]
        distinct_on: decoded_key
        where: {table_handle: {_eq: "answers_id"}}
      ) {
        decoded_value
        transaction_version
      }
    }
  `;

async function run() {
    let quest_ids = null;
    let game_id = null;

    //If not created, create new game on-chain and write its id to a file
    try {
        game_id = fs.readFileSync(game_id_file, 'utf8').trim();
        answers_id = fs.readFileSync(answers_id_file, 'utf8').trim();
        profiles_id = fs.readFileSync(profiles_id_file, 'utf8').trim();
    }
    catch {
        game_id = await create_game();
        exit();
    }

    //If quests were not uploaded, create and upload them on-chain
    try {
        quest_ids = fs.readFileSync(quest_ids_file, 'utf-8').split('\n').map(line => line.trim());
    }
    catch {
        for (let index = 0; index < P_xys_and_questions.length; index++) {
            const P_xy_and_question = P_xys_and_questions[index];
            await upload_quest(game_id, P_xy_and_question);
            await new Promise(r => setTimeout(r, 1 * 1000));
        }
        fs.appendFile(quest_ids_file, "-1", (err) => {
            if (err) throw err;
            console.log('Quest ids file created just to mark that we uploaded first batch of quests');
        });
        exit();
    }

    //The main infinite loop 
    //Load new answers from GraphQL Aptos indexer
    //Create proofs and submit on-chain to verify answers
    if (game_id) {

        while (1 == 1) {
            try {
                //Fetch newest unverified attempts
                const res = (await fetchGraphQL(
                    operationsDoc.replace("answers_id", paddedHex(answers_id),
                        "MyQuery",
                        {}
                    ), null, null, net
                )).data.table_items.filter(item => item.decoded_value);
                console.log(res);

                //Verify attempts by submiting the proof on-chain
                //TODO: In parallel launch process all the answers found not just [0]
                //Better aggregate this in one transaction
                if (res?.length > 0)
                    await process_attempt(game_id, res, P_xys_and_questions).catch((e) => { console.log(e) });
                console.log("Checked all new answers, now do the 1.0 seconds pause");
                await new Promise(r => setTimeout(r, 1000));
            }
            catch (err) {
                console.log("For some reason failed to process answers", err)
            }
        }
    }
}

run()
