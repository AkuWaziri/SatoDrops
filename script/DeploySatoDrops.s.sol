// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SatoDrops} from "../contracts/SatoDrops.sol";

contract DeploySatoDrops {
    function run() external returns (SatoDrops deployed) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address feeRecipient = vm.envAddress("FEE_RECIPIENT");

        vm.startBroadcast(privateKey);
        deployed = new SatoDrops(feeRecipient);
        vm.stopBroadcast();
    }
}
