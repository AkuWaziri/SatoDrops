// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {SatoDropsFCFS} from "../contracts/SatoDropsFCFS.sol";

contract DeploySatoDropsFCFS is Script {
    function run() external returns (SatoDropsFCFS deployed) {
        address feeRecipient = vm.envAddress("SATODROPS_FEE_RECIPIENT");
        address verificationSigner = vm.envAddress("SATODROPS_VERIFICATION_SIGNER");

        vm.startBroadcast();
        deployed = new SatoDropsFCFS(feeRecipient, verificationSigner);
        vm.stopBroadcast();

        console2.log("SatoDropsFCFS deployed at:", address(deployed));
        console2.log("Fee recipient:", feeRecipient);
        console2.log("Verification signer:", verificationSigner);
        console2.log("Chain ID:", block.chainid);
    }
}
