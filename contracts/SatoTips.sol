// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

contract SatoTips {
    uint256 public constant CREATION_FEE_BPS = 100; // 1%
    uint256 public constant CLAIM_FEE_BPS = 50; // 0.5%

    uint8 public constant IDENTITY_X = 1;
    uint8 public constant IDENTITY_TELEGRAM = 2;
    uint8 public constant IDENTITY_WALLET = 3;

    address public immutable feeRecipient;
    address public immutable identityVerifier;

    uint256 private unlocked = 1;

    struct Tip {
        address creator;
        address token;
        uint128 amount;
        uint64 expiresAt;
        bool claimed;
        bool closed;
        uint8 identityType;
        bytes32 identityHash;
        string message;
    }

    uint256 public nextTipId;
    mapping(uint256 => Tip) public tips;

    event TipCreated(
        uint256 indexed tipId,
        address indexed creator,
        address indexed token,
        uint256 amount,
        uint256 expiresAt,
        uint8 identityType,
        bytes32 identityHash,
        uint256 creationFee,
        uint256 claimFeeReserved
    );
    event TipClaimed(uint256 indexed tipId, address indexed claimant, uint256 reward, uint256 claimFee);
    event TipClosed(uint256 indexed tipId, uint256 refunded);

    error InvalidToken();
    error InvalidAmount();
    error InvalidIdentity();
    error InvalidExpiry();
    error Expired();
    error Closed();
    error AlreadyClaimed();
    error NotCreator();
    error NotAuthorized();
    error InvalidSignature();
    error TransferFailed();
    error Reentrant();

    modifier nonReentrant() {
        if (unlocked != 1) revert Reentrant();
        unlocked = 2;
        _;
        unlocked = 1;
    }

    constructor(address _feeRecipient, address _identityVerifier) {
        if (_feeRecipient == address(0) || _identityVerifier == address(0)) revert InvalidToken();
        feeRecipient = _feeRecipient;
        identityVerifier = _identityVerifier;
    }

    function createTip(
        address token,
        uint128 amount,
        uint64 expiresAt,
        uint8 identityType,
        bytes32 identityHash,
        string calldata message
    ) external nonReentrant returns (uint256 tipId) {
        if (token == address(0)) revert InvalidToken();
        if (amount == 0) revert InvalidAmount();
        if (identityType < IDENTITY_X || identityType > IDENTITY_WALLET) revert InvalidIdentity();
        if (identityHash == bytes32(0)) revert InvalidIdentity();
        if (expiresAt != 0 && expiresAt <= block.timestamp) revert InvalidExpiry();

        uint256 creationFee = (uint256(amount) * CREATION_FEE_BPS) / 10_000;
        uint256 claimFeeReserved = (uint256(amount) * CLAIM_FEE_BPS) / 10_000;

        _safeTransferFrom(token, msg.sender, feeRecipient, creationFee);
        _safeTransferFrom(token, msg.sender, address(this), uint256(amount) + claimFeeReserved);

        tipId = nextTipId++;
        tips[tipId] = Tip({
            creator: msg.sender,
            token: token,
            amount: amount,
            expiresAt: expiresAt,
            claimed: false,
            closed: false,
            identityType: identityType,
            identityHash: identityHash,
            message: message
        });

        emit TipCreated(
            tipId,
            msg.sender,
            token,
            amount,
            expiresAt,
            identityType,
            identityHash,
            creationFee,
            claimFeeReserved
        );
    }

    function claimTip(
        uint256 tipId,
        bytes calldata verificationSignature
    ) external nonReentrant {
        Tip storage tip = tips[tipId];
        if (tip.creator == address(0)) revert InvalidAmount();
        if (tip.closed) revert Closed();
        if (tip.claimed) revert AlreadyClaimed();
        if (tip.expiresAt != 0 && block.timestamp >= tip.expiresAt) revert Expired();

        if (tip.identityType == IDENTITY_WALLET) {
            if (tip.identityHash != keccak256(abi.encodePacked(msg.sender))) revert NotAuthorized();
        } else {
            bytes32 digest = keccak256(
                abi.encodePacked(
                    "\x19Ethereum Signed Message:\n32",
                    keccak256(abi.encode(address(this), block.chainid, tipId, msg.sender, tip.identityType, tip.identityHash))
                )
            );
            (address signer, ) = _recover(digest, verificationSignature);
            if (signer != identityVerifier) revert InvalidSignature();
        }

        tip.claimed = true;

        uint256 reward = uint256(tip.amount);
        uint256 claimFee = (reward * CLAIM_FEE_BPS) / 10_000;

        _safeTransfer(tip.token, msg.sender, reward);
        _safeTransfer(tip.token, feeRecipient, claimFee);

        emit TipClaimed(tipId, msg.sender, reward, claimFee);
    }

    function closeExpiredTip(uint256 tipId) external nonReentrant {
        Tip storage tip = tips[tipId];
        if (tip.creator == address(0)) revert InvalidAmount();
        if (msg.sender != tip.creator) revert NotCreator();
        if (tip.closed) revert Closed();
        if (tip.expiresAt == 0 || block.timestamp < tip.expiresAt) revert InvalidExpiry();

        tip.closed = true;

        uint256 reward = uint256(tip.amount);
        uint256 claimFeeReserved = (reward * CLAIM_FEE_BPS) / 10_000;
        uint256 refund = reward + claimFeeReserved;

        if (refund > 0) _safeTransfer(tip.token, tip.creator, refund);
        emit TipClosed(tipId, refund);
    }

    function _recover(bytes32 digest, bytes memory signature) private pure returns (address signer, bool ok) {
        if (signature.length != 65) return (address(0), false);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
            v := byte(0, mload(add(signature, 96)))
        }
        if (v < 27) v += 27;
        if (v != 27 && v != 28) return (address(0), false);
        signer = ecrecover(digest, v, r, s);
        return (signer, signer != address(0));
    }

    function _safeTransfer(address token, address to, uint256 value) private {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20.transfer.selector, to, value)
        );
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    function _safeTransferFrom(address token, address from, address to, uint256 value) private {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, value)
        );
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }
}
