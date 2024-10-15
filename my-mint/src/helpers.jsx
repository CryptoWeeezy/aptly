//The following four functions are just playing with encoding between field Big integers
//and their representations inside of the smart contract
export function arr_to_bigint(arr) {
  let result = BigInt(0);
  for (let i = arr.length - 1; i >= 0; i--) {
    result = result * BigInt(256) + BigInt(arr[i]);
  }
  return result;
}export function arr_from_hex(hexString) {
  const _hexString = hexString.replace("0x", "");
  const utf8Encoder = new TextEncoder();
  const utf8Decoder = new TextDecoder();
  const bytes = utf8Encoder.encode(_hexString);
  const hex = new Uint8Array(bytes.length / 2);

  for (let i = 0; i < bytes.length; i += 2) {
    const byte1 = bytes[i] - 48 > 9 ? bytes[i] - 87 : bytes[i] - 48;
    const byte2 = bytes[i + 1] - 48 > 9 ? bytes[i + 1] - 87 : bytes[i + 1] - 48;
    hex[i / 2] = byte1 * 16 + byte2;
  }

  return hex;
}
export const utf8_hex_to_int = (hex) => {
  console.log({ hex });
  //const hex = new TextDecoder().decode(new Uint8Array(by));
  const arr = new Uint8Array(
    hex.replace("0x", "").match(/.{1,2}/g).map((byte) => parseInt(byte, 16))
  );
  return arr_to_bigint(arr);
};
export function addr_to_bigint(addr) {
  const interm = arr_from_hex(addr);
  //Zeroize the last - most significant byte of address to prevent the number being bigger than base Field modulo
  interm[31] = 0;
  return arr_to_bigint(interm);
}
// Conversion function: number to alphabet
export const numberToAlphabet = (num) => {
  return num;
  //for now disabled
  return String.fromCharCode(65 + num - 1); // 'A' = 65
};
export function arrayToDict(array) {
  const dict = {};
  if (!array) return dict;
  array.forEach(entry => {
    const key = entry.key;
    const value = entry.value;
    dict[key] = value;
  });
  return dict;
}
export function compareAndNotify(oldState, newState, notifyChange) {
  const allKeys = new Set([...Object.keys(oldState), ...Object.keys(newState)]);

  allKeys.forEach(key => {
    const oldValue = oldState[key];
    const newValue = newState[key];
    console.log({ oldValue, newValue });
    if (oldValue !== newValue) {
      // Call your custom notification function with the key and new value
      notifyChange(key, newValue);
    }
  });
}
export function hex_to_movevector(hexString) {
  //console.log({hexString})
  //return "0x" + hexString;
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
  console.log({ byteArray });

  return byteArray;
}