require('dotenv').config();
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { AptosConfig, Aptos, Account, Network, Ed25519PrivateKey } = require('@aptos-labs/ts-sdk');
const { exit } = require('process');

// Load environment variables
const privKey = process.env.PRIVATE_KEY;
const cliPath = 'aptos'; // CLI path (assuming it's in your system's path)
const packagePath = '../aptos_verifier'; // Path to your Move package

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

// Initialize Aptos config with the selected network
const config = new AptosConfig({ network });
console.log(`Aptos client initialized for ${networkArg || 'testnet'}`);

// Initialize Aptos client and account
const aptos = new Aptos(config);
const privateKey = new Ed25519PrivateKey(privKey);
// Or for Secp256k1 scheme
//const privateKey = new Secp256k1PrivateKey("mySecp256k1privatekeystring");

const account = Account.fromPrivateKey({ privateKey });

// Function to compile Move package using CLI. It saves payload to an output json file.
function compilePackage(packageDir, outputFile, namedAddresses) {
    console.log("In order to run compilation, you must have the `aptos` CLI installed.");
    try {
        execSync(`${cliPath} --version`);
    } catch (e) {
        console.log("aptos is not installed. Please install it from the instructions on aptos.dev");
        throw e;
    }

    const addressArg = namedAddresses.map(({ name, address }) => `${name}=${address}`).join(" ");

    const compileCommand = `${cliPath} move build-publish-payload --json-output-file ${outputFile} --package-dir ${packageDir} --named-addresses ${addressArg} --assume-yes`;
    console.log("Running the compilation locally...");
    execSync(compileCommand, { stdio: 'inherit' });
}

// Function to retrieve the compiled package metadataBytes and byteCode
function getPackageBytesToPublish(filePath) {
    const cwd = process.cwd();
    const modulePath = path.join(cwd, filePath);

    const jsonData = JSON.parse(fs.readFileSync(modulePath, "utf8"));

    const metadataBytes = jsonData.args[0].value;
    const byteCode = jsonData.args[1].value;

    return { metadataBytes, byteCode };
}

// Function to get a script's byteCode
function getMoveBytes(filePath) {
    const cwd = process.cwd();
    const modulePath = path.join(cwd, filePath);
    const buffer = fs.readFileSync(modulePath);
    return Uint8Array.from(buffer);
}

// Function to publish the Move package
async function publishMovePackage(metadataBytes, byteCode) {
    try {
        const payload = {
            function: '0x1::code::publish_package_txn',
            functionArguments: [metadataBytes, byteCode]
        };

        console.log(account.accountAddress)
        // Build, sign, and submit the transaction
        console.log('Building transaction...');
        const rawTxn = await aptos.publishPackageTransaction({
            account: account.accountAddress,
            metadataBytes,
            moduleBytecode: [byteCode[0]],
           })
        const senderAuthenticator = await aptos.transaction.sign({signer: account, transaction: rawTxn});
        const txnResult = await aptos.transaction.submit.simple({
            transaction: rawTxn,
            senderAuthenticator,
        });
        console.log(`Transaction submitted with hash: ${txnResult.hash}`);

        // Wait for transaction confirmation
        const txnDetails = await aptos.waitForTransaction({transactionHash: txnResult.hash});
        console.log(txnDetails);
        

        // Get transaction details
        const createdObjects = txnDetails.events.filter(event => event.type === "0x1::code::PublishPackage");
        console.log(createdObjects[0].data)
        const packageId = createdObjects[0].data.code_address;

        // Save package ID to file
        //Actually this is just the creator address, but I will leave it here for formal correctness. 
        fs.writeFileSync('package.id', packageId);
        console.log('Package ID saved to file:', packageId);
    } catch (error) {
        console.error('Error during publishing:', error);
    }
}

// Main function to compile and publish
(async function main() {
    try {
        const namedAddresses = [
            { name: 'aptos_verifier', address: 'default' } // Fill in the addresses accordingly
        ];
        const outputFile = 'output.json';  // Specify output JSON file path

        // Compile the package and get metadataBytes and byteCode
        compilePackage(packagePath, outputFile, namedAddresses);
        const { metadataBytes, byteCode } = getPackageBytesToPublish(outputFile);
        //console.log({ metadataBytes, byteCode } );
        
        // Publish the package
        await publishMovePackage(metadataBytes, byteCode);
    } catch (error) {
        console.error('Error in the process:', error);
    }
})();
