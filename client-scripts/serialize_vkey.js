const fs = require("fs")
const {vkey_prepared_serialize, proof_serialize, public_input_serialize, vkey_serialize_by_parts } = require("../ark-serializer/pkg_node");
const main = async () => {
    const commit_vk_json = fs.readFileSync("./compiled_circuits/commit_main.groth16.vkey.json").toString();
    const unlock_vk_json = fs.readFileSync("./compiled_circuits/unlock_main.groth16.vkey.json").toString();

    const commit_vkey_serialized = vkey_serialize_by_parts(commit_vk_json);
    const unlock_vkey_serialized = vkey_serialize_by_parts(unlock_vk_json);

    console.log({ commit_vkey_serialized, unlock_vkey_serialized })
}

// main()
//wasm-pack build --target nodejs --out-dir pkg_node
main()