// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SatoDrops FCFS
/// @notice Public first-come-first-served drops protected by creator activation
///         and one-time, wallet-bound EIP-712 claim authorizations.
interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

contract SatoDropsFCFS {
    uint256 public constant CREATION_FEE_BPS = 100;
    uint256 public constant CLAIM_FEE_BPS = 50;

    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant CLAIM_TYPEHASH =
        keccak256("ClaimAuthorization(uint256 dropId,address claimant,uint256 nonce,uint256 deadline)");

    bytes32 public immutable DOMAIN_SEPARATOR;
    address public immutable feeRecipient;
    address public verificationSigner;

    uint256 private unlocked = 1;
    uint256 public nextDropId;

    struct Drop {
        address creator;
        address token;
        uint128 amountPerClaim;
        uint64 maxClaims;
        uint64 claimed;
        uint64 expiresAt;
        bool active;
        bool closed;
        string message;
    }

    mapping(uint256 => Drop) public drops;
    mapping(uint256 => mapping(address => bool)) public hasClaimed;
    mapping(uint256 => mapping(address => uint256)) public claimNonces;

    event DropCreated(uint256 indexed dropId,address indexed creator,address indexed token,uint256 amountPerClaim,uint256 maxClaims,uint256 expiresAt,uint256 rewardTotal,uint256 creationFee,uint256 claimFeesReserved);
    event DropActivated(uint256 indexed dropId, uint256 activatedAt);
    event DropClaimed(uint256 indexed dropId, address indexed claimant, uint256 reward, uint256 claimFee);
    event DropClosed(uint256 indexed dropId, uint256 refunded);
    event VerificationSignerUpdated(address indexed signer);

    error InvalidToken();
    error InvalidAmount();
    error InvalidClaims();
    error Expired();
    error Closed();
    error NotCreator();
    error NotActive();
    error AlreadyClaimed();
    error SoldOut();
    error InvalidAuthorization();
    error AuthorizationExpired();
    error InvalidSignature();
    error TransferFailed();
    error Reentrant();

    modifier nonReentrant() {
        if (unlocked != 1) revert Reentrant();
        unlocked = 2;
        _;
        unlocked = 1;
    }

    constructor(address _feeRecipient, address _verificationSigner) {
        if (_feeRecipient == address(0) || _verificationSigner == address(0)) revert InvalidToken();
        feeRecipient = _feeRecipient;
        verificationSigner = _verificationSigner;
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256(bytes("SatoDrops FCFS")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    function createDrop(address token,uint128 amountPerClaim,uint64 maxClaims,uint64 expiresAt,string calldata message)
        external nonReentrant returns (uint256 dropId)
    {
        if (token == address(0)) revert InvalidToken();
        if (amountPerClaim == 0) revert InvalidAmount();
        if (maxClaims == 0) revert InvalidClaims();
        if (expiresAt != 0 && expiresAt <= block.timestamp) revert Expired();

        uint256 rewardTotal = uint256(amountPerClaim) * uint256(maxClaims);
        uint256 creationFee = (rewardTotal * CREATION_FEE_BPS) / 10_000;
        uint256 claimFeesReserved = (rewardTotal * CLAIM_FEE_BPS) / 10_000;

        _safeTransferFrom(token, msg.sender, address(this), rewardTotal + creationFee + claimFeesReserved);
        if (creationFee > 0) _safeTransfer(token, feeRecipient, creationFee);

        dropId = nextDropId++;
        drops[dropId] = Drop({
            creator: msg.sender,
            token: token,
            amountPerClaim: amountPerClaim,
            maxClaims: maxClaims,
            claimed: 0,
            expiresAt: expiresAt,
            active: false,
            closed: false,
            message: message
        });

        emit DropCreated(dropId,msg.sender,token,amountPerClaim,maxClaims,expiresAt,rewardTotal,creationFee,claimFeesReserved);
    }

    function activateDrop(uint256 dropId) external {
        Drop storage drop = drops[dropId];
        if (drop.creator == address(0)) revert InvalidAmount();
        if (msg.sender != drop.creator) revert NotCreator();
        if (drop.closed) revert Closed();
        if (drop.active) return;
        if (drop.expiresAt != 0 && block.timestamp >= drop.expiresAt) revert Expired();
        drop.active = true;
        emit DropActivated(dropId, block.timestamp);
    }

    function claim(uint256 dropId,uint256 deadline,bytes calldata signature) external nonReentrant {
        Drop storage drop = drops[dropId];
        if (drop.creator == address(0)) revert InvalidAmount();
        if (!drop.active) revert NotActive();
        if (drop.closed) revert Closed();
        if (drop.expiresAt != 0 && block.timestamp >= drop.expiresAt) revert Expired();
        if (drop.claimed >= drop.maxClaims) revert SoldOut();
        if (hasClaimed[dropId][msg.sender]) revert AlreadyClaimed();
        if (deadline < block.timestamp) revert AuthorizationExpired();

        uint256 nonce = claimNonces[dropId][msg.sender];
        bytes32 structHash = keccak256(abi.encode(CLAIM_TYPEHASH,dropId,msg.sender,nonce,deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01",DOMAIN_SEPARATOR,structHash));
        if (_recover(digest,signature) != verificationSigner) revert InvalidSignature();

        claimNonces[dropId][msg.sender] = nonce + 1;
        hasClaimed[dropId][msg.sender] = true;
        drop.claimed += 1;

        uint256 reward = uint256(drop.amountPerClaim);
        uint256 claimFee = (reward * CLAIM_FEE_BPS) / 10_000;
        _safeTransfer(drop.token,msg.sender,reward);
        _safeTransfer(drop.token,feeRecipient,claimFee);

        emit DropClaimed(dropId,msg.sender,reward,claimFee);
    }

    function closeExpiredDrop(uint256 dropId) external nonReentrant {
        Drop storage drop = drops[dropId];
        if (drop.creator == address(0)) revert InvalidAmount();
        if (msg.sender != drop.creator) revert NotCreator();
        if (drop.closed) revert Closed();
        if (drop.expiresAt == 0 || block.timestamp < drop.expiresAt) revert Expired();

        drop.closed = true;
        uint256 remainingClaims = uint256(drop.maxClaims) - uint256(drop.claimed);
        uint256 remainingRewards = uint256(drop.amountPerClaim) * remainingClaims;
        uint256 remainingClaimFees = (remainingRewards * CLAIM_FEE_BPS) / 10_000;
        uint256 refund = remainingRewards + remainingClaimFees;
        if (refund > 0) _safeTransfer(drop.token,drop.creator,refund);
        emit DropClosed(dropId,refund);
    }

    function _recover(bytes32 digest, bytes calldata signature) private pure returns (address) {
        if (signature.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (v < 27) v += 27;
        if (v != 27 && v != 28) return address(0);
        if (uint256(s) > 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0) return address(0);
        return ecrecover(digest,v,r,s);
    }

    function _safeTransfer(address token,address to,uint256 value) private {
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.transfer.selector,to,value));
        if (!success) _bubble(data);
        if (data.length != 0 && !abi.decode(data,(bool))) revert TransferFailed();
    }

    function _safeTransferFrom(address token,address from,address to,uint256 value) private {
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.transferFrom.selector,from,to,value));
        if (!success) _bubble(data);
        if (data.length != 0 && !abi.decode(data,(bool))) revert TransferFailed();
    }

    function _bubble(bytes memory data) private pure {
        if (data.length == 0) revert TransferFailed();
        assembly {
            revert(add(data,32),mload(data))
        }
    }
}
