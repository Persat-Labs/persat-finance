"use client";
import { useState, useEffect, useCallback } from "react";
import { getProfileByWalletOrUsername } from "@/lib/profile/userProfile";

export interface DealProposalAttachment {
  dealId?: string;
  principal: string;
  currency: "USDC" | "USDT";
  collateralBtc: string;
  rateBps: string;
  months: number;
  side: "borrower" | "lender";
  status: "proposed" | "accepted" | "declined" | "countered";
}

export interface DirectMessage {
  id: string;
  conversationId: string;
  senderWallet: string;
  recipientWallet: string;
  senderHandle: string;
  text: string;
  dealProposal?: DealProposalAttachment;
  createdAt: number;
}

const STORAGE_MESSAGES_KEY = "persat_direct_messages_v1";

function getConversationId(walletA: string, walletB: string): string {
  return [walletA, walletB].sort().join("::");
}

const SEED_MESSAGES: DirectMessage[] = [
  {
    id: "msg_seed_1",
    conversationId: getConversationId(
      "8mdkcgNT2CDk5G9Pes55SUf7TkMxPpVvpu5wTL2myUWL",
      "2G2avktDrH2GTf5bodA6PnLK6zNhAp4Nxfxp4n3maCsX",
    ),
    senderWallet: "2G2avktDrH2GTf5bodA6PnLK6zNhAp4Nxfxp4n3maCsX",
    recipientWallet: "8mdkcgNT2CDk5G9Pes55SUf7TkMxPpVvpu5wTL2myUWL",
    senderHandle: "lender_prime",
    text: "Hello! I saw your direct deal request. I am willing to fund 1,000 USDC at 8.2% annual rate backed by 0.05 tBTC.",
    dealProposal: {
      principal: "1000",
      currency: "USDC",
      collateralBtc: "0.05",
      rateBps: "820",
      months: 12,
      side: "lender",
      status: "proposed",
    },
    createdAt: Date.now() - 3600000,
  },
  {
    id: "msg_seed_2",
    conversationId: getConversationId(
      "8mdkcgNT2CDk5G9Pes55SUf7TkMxPpVvpu5wTL2myUWL",
      "2G2avktDrH2GTf5bodA6PnLK6zNhAp4Nxfxp4n3maCsX",
    ),
    senderWallet: "8mdkcgNT2CDk5G9Pes55SUf7TkMxPpVvpu5wTL2myUWL",
    recipientWallet: "2G2avktDrH2GTf5bodA6PnLK6zNhAp4Nxfxp4n3maCsX",
    senderHandle: "borrower_alpha",
    text: "These terms look solid. I will deposit the 0.05 tBTC collateral right away!",
    createdAt: Date.now() - 1800000,
  },
];

function getStoredMessages(): DirectMessage[] {
  if (typeof window === "undefined") return SEED_MESSAGES;
  try {
    const raw = localStorage.getItem(STORAGE_MESSAGES_KEY);
    if (!raw) {
      localStorage.setItem(STORAGE_MESSAGES_KEY, JSON.stringify(SEED_MESSAGES));
      return SEED_MESSAGES;
    }
    return JSON.parse(raw);
  } catch {
    return SEED_MESSAGES;
  }
}

export function useDirectMessages(myWallet: string | null | undefined) {
  const [messages, setMessages] = useState<DirectMessage[]>([]);

  const load = useCallback(() => {
    setMessages(getStoredMessages());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const sendMessage = useCallback(
    (recipientInput: string, text: string, proposal?: DealProposalAttachment) => {
      if (!myWallet) return null;
      // Resolve recipient wallet from handle or address
      const targetProfile = getProfileByWalletOrUsername(recipientInput);
      const recipientWallet = targetProfile ? targetProfile.wallet : recipientInput.trim();

      const myProfile = getProfileByWalletOrUsername(myWallet);
      const senderHandle = myProfile ? myProfile.username : myWallet.slice(0, 6);

      const convId = getConversationId(myWallet, recipientWallet);
      const newMsg: DirectMessage = {
        id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        conversationId: convId,
        senderWallet: myWallet,
        recipientWallet,
        senderHandle,
        text,
        dealProposal: proposal,
        createdAt: Date.now(),
      };

      const all = [...getStoredMessages(), newMsg];
      localStorage.setItem(STORAGE_MESSAGES_KEY, JSON.stringify(all));
      setMessages(all);
      return newMsg;
    },
    [myWallet],
  );

  const updateProposalStatus = useCallback(
    (messageId: string, newStatus: DealProposalAttachment["status"]) => {
      const all = getStoredMessages().map((m) => {
        if (m.id === messageId && m.dealProposal) {
          return {
            ...m,
            dealProposal: {
              ...m.dealProposal,
              status: newStatus,
            },
          };
        }
        return m;
      });
      localStorage.setItem(STORAGE_MESSAGES_KEY, JSON.stringify(all));
      setMessages(all);
    },
    [],
  );

  // Conversations relevant to me
  const myConversations = messages.filter(
    (m) => myWallet && (m.senderWallet === myWallet || m.recipientWallet === myWallet),
  );

  // Group by counterparty
  const conversationPartners = Array.from(
    new Set(
      myConversations.map((m) => (m.senderWallet === myWallet ? m.recipientWallet : m.senderWallet)),
    ),
  );

  return {
    messages,
    myConversations,
    conversationPartners,
    sendMessage,
    updateProposalStatus,
    reloadMessages: load,
  };
}
