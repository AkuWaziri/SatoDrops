// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

contract SatoDrops {
    uint256 public constant CREATION_FEE_BPS = 100; // 1%
    uint256 public constant CLAIM_FEE_BPS = 50; // 0.5%
    address public immutable feeRecipient;

    struct Drop {
        address creator;
        address token;
        uint128 amountPerClaim;
        uint64 maxClaims;
        uint64 claimed;
        uint64 expiresAt;
        bool closed;
        string message;
    }

    uint256 public nextDropId;
    mapping(uint256 => Drop) public drops;
    mapping(uint256 => mapping(address => bool)) public hasClaimed;

    event DropCreated(
        uint256 indexed dropId,
        address indexed creator,
        address indexed token,
        uint256 amountPerClaim,
        uint256 maxClaims,
        uint256 expiresAt,
        uint256 rewardTotal,
        uint256 creationFee,
        uint256 claimFeesReserved
    );
    event DropClaimed(uint256 indexed dropId, address indexed claimant, uint256 reward, uint256 claimFee);
    event DropClosed(uint256 indexed dropId, uint256 refunded);

    error InvalidToken();
    error InvalidAmount();
    error InvalidClaims();
    error Expired();
    error NotExpired();
    error Closed();
    error AlreadyClaimed();
    error SoldOut();
    error TransferFailed();
    error NotCreator();

    constructor(address _feeRecipient) {
        if (_feeRecipient == address(0)) revert InvalidToken();
        feeRecipient = _feeRecipient;
    }

    function createDrop(
        address token,
        uint128 amountPerClaim,
        uint64 maxClaims,
        uint64 expiresAt,
        string calldata message
    ) external returns (uint256 dropId) {
        if (token == address(0)) revert InvalidToken();
        if (amountPerClaim == 0) revert InvalidAmount();
        if (maxClaims == 0) revert InvalidClaims();
        if (expiresAt != 0 && expiresAt <= block.timestamp) revert Expired();

        uint256 rewardTotal = uint256(amountPerClaim) * uint256(maxClaims);
        uint256 creationFee = (rewardTotal * CREATION_FEE_BPS) / 10_000;
        uint256 claimFeesReserved = (rewardTotal * CLAIM_FEE_BPS) / 10_000;
        uint256 totalFunding = rewardTotal + creationFee + claimFeesReserved;

        if (!IERC20(token).transferFrom(msg.sender, feeRecipient, creationFee)) revert TransferFailed();
        if (!IERC20(token).transferFrom(msg.sender, address(this), rewardTotal + claimFeesReserved)) revert TransferFailed();

        dropId = nextDropId++;
        drops[dropId] = Drop({
            creator: msg.sender,
            token: token,
            amountPerClaim: amountPerClaim,
            maxClaims: maxClaims,
            claimed: 0,
            expiresAt: expiresAt,
            closed: false,
            message: message
        });

        emit DropCreated(
            dropId,
            msg.sender,
            token,
            amountPerClaim,
            maxClaims,
            expiresAt,
            rewardTotal,
            creationFee,
            claimFeesReserved
        );
        totalFunding;
    }

    function claim(uint256 dropId) external {
        Drop storage drop = drops[dropId];
        if (drop.creator == address(0)) revert InvalidAmount();
        if (drop.closed) revert Closed();
        if (drop.expiresAt != 0 && block.timestamp >= drop.expiresAt) revert Expired();
        if (drop.claimed >= drop.maxClaims) revert SoldOut();
        if (hasClaimed[dropId][msg.sender]) revert AlreadyClaimed();

        hasClaimed[dropId][msg.sender] = true;
        drop.claimed += 1;

        uint256 reward = uint256(drop.amountPerClaim);
        uint256 claimFee = (reward * CLAIM_FEE_BPS) / 10_000;

        if (!IERC20(drop.token).transfer(msg.sender, reward)) revert TransferFailed();
        if (!IERC20(drop.token).transfer(feeRecipient, claimFee)) revert TransferFailed();

        emit DropClaimed(dropId, msg.sender, reward, claimFee);
    }

    function closeExpiredDrop(uint256 dropId) external {
        Drop storage drop = drops[dropId];
        if (drop.creator == address(0)) revert InvalidAmount();
        if (msg.sender != drop.creator) revert NotCreator();
        if (drop.closed) revert Closed();
        if (drop.expiresAt == 0 || block.timestamp < drop.expiresAt) revert NotExpired();

        drop.closed = true;
        uint256 remaining = uint256(drop.amountPerClaim) * (uint256(drop.maxClaims) - uint256(drop.claimed));
        uint256 remainingClaimFees = (remaining * CLAIM_FEE_BPS) / 10_000;
        uint256 refund = remaining + remainingClaimFees;

        if (refund > 0 && !IERC20(drop.token).transfer(drop.creator, refund)) revert TransferFailed();
        emit DropClosed(dropId, refund);
    }
}
