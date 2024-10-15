function arr_to_bigint(arr) {
    //let arr = new Uint8Array(buf);
    let result = BigInt(0);
    for (let i = arr.length - 1; i >= 0; i--) {
        result = result * BigInt(256) + BigInt(arr[i]);
    }
    return result;
}
exports.arr_to_bigint = arr_to_bigint;

function arr_from_hex(hexString) {
    const _hexString = hexString.replace("0x", "");
    console.log(_hexString);
    const hex = Uint8Array.from(Buffer.from(_hexString, 'hex'));
    console.log(hex);
    return hex;
}
exports.arr_from_hex = arr_from_hex;

function addr_to_bigint(addr, flush = true) {
    const interm = arr_from_hex(addr);
    //Zeroize the last - most significant byte of address to prevent the number being bigger than base Field modulo
    if (flush) interm[31] = 0;
    return arr_to_bigint(interm);
}
exports.addr_to_bigint = addr_to_bigint;

const utf8_hex_to_int = (by) => {
    if (by.startsWith('0x')) {
        by = by.slice(2);
    }
    const st = by; //Buffer.from(by).toString('utf8');

    //console.log({ st })
    const arr = Uint8Array.from(Buffer.from(st, 'hex'));
    //console.log({ arr })
    return arr_to_bigint(arr);
};
exports.utf8_hex_to_int = utf8_hex_to_int;

async function fetchGraphQL(operationsDoc, operationName, variables, net ='testnet') {
    const result = await fetch(
        `https://api.${net}.aptoslabs.com/v1/graphql`,
        {
            method: "POST",
            body: JSON.stringify({
                query: operationsDoc,
                variables: variables,
                operationName: operationName
            })
        }
    );

    return await result.json();
}
exports.fetchGraphQL = fetchGraphQL;
const paddedHex = (hex) => `0x${hex.slice(2).padStart(64, '0')}`;
exports.paddedHex = paddedHex;

