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
  read: boolean;
}

const STORAGE_MESSAGES_KEY = "persat_direct_messages_live_v2";

function getConversationId(walletA: string, walletB: string): string {
  return [walletA, walletB].sort().join("::");
}

function getStoredMessages(): DirectMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_MESSAGES_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
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
        read: false,
      };

      const all = [...getStoredMessages(), newMsg];
      localStorage.setItem(STORAGE_MESSAGES_KEY, JSON.stringify(all));
      setMessages(all);
      return newMsg;
    },
    [myWallet],
  );

  const markAsRead = useCallback(
    (partnerWallet: string) => {
      if (!myWallet) return;
      const all = getStoredMessages().map((m) => {
        if (m.senderWallet === partnerWallet && m.recipientWallet === myWallet) {
          return { ...m, read: true };
        }
        return m;
      });
      localStorage.setItem(STORAGE_MESSAGES_KEY, JSON.stringify(all));
      setMessages(all);
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

  // Messages relevant to my wallet
  const myConversations = messages.filter(
    (m) => myWallet && (m.senderWallet === myWallet || m.recipientWallet === myWallet),
  );

  // Unread messages where I am the recipient
  const unreadMessages = myConversations.filter(
    (m) => m.recipientWallet === myWallet && !m.read,
  );
  const unreadCount = unreadMessages.length;

  // Distinct conversation partners
  const conversationPartners = Array.from(
    new Set(
      myConversations.map((m) => (m.senderWallet === myWallet ? m.recipientWallet : m.senderWallet)),
    ),
  );

  return {
    messages,
    myConversations,
    unreadMessages,
    unreadCount,
    conversationPartners,
    sendMessage,
    markAsRead,
    updateProposalStatus,
    reloadMessages: load,
  };
}
