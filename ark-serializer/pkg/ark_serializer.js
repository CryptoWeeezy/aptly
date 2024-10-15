import * as wasm from "./ark_serializer_bg.wasm";
export * from "./ark_serializer_bg.js";
import { __wbg_set_wasm } from "./ark_serializer_bg.js";
__wbg_set_wasm(wasm);