"use client";
import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { AppFrame } from "@/components/AppFrame";
import { Button, Card, Input } from "@/lib/design-system";
import { useProtocol } from "@/lib/protocol/hooks";
import { useDirectMessages, DealProposalAttachment } from "@/lib/messages/messagesStore";
import { getProfileByWalletOrUsername } from "@/lib/profile/userProfile";

export default function MessagesPage() {
  const searchParams = useSearchParams();
  const initialPartnerParam = searchParams.get("partner");

  const { publicKey } = useProtocol();
  const myWallet = publicKey ? publicKey.toBase58() : null;
  const {
    messages,
    conversationPartners,
    sendMessage,
    markAsRead,
    updateProposalStatus,
  } = useDirectMessages(myWallet);

  const [activePartner, setActivePartner] = useState<string | null>(initialPartnerParam || null);
  const [newMsgText, setNewMsgText] = useState("");
  const [newPartnerInput, setNewPartnerInput] = useState("");
  const [showNewChat, setShowNewChat] = useState(false);
  const [showProposeCard, setShowProposeCard] = useState(false);

  // Proposal attachment state
  const [propPrincipal, setPropPrincipal] = useState("1000");
  const [propRate, setPropRate] = useState("820");
  const [propMonths, setPropMonths] = useState(12);

  // Auto-select initial partner if provided in query
  useEffect(() => {
    if (initialPartnerParam) {
      setActivePartner(initialPartnerParam);
      if (myWallet) markAsRead(initialPartnerParam);
    } else if (conversationPartners.length > 0 && !activePartner) {
      setActivePartner(conversationPartners[0]);
    }
  }, [initialPartnerParam, conversationPartners, activePartner, myWallet, markAsRead]);

  const activeProfile = activePartner ? getProfileByWalletOrUsername(activePartner) : null;
  const partnerTitle = activeProfile?.username
    ? `@${activeProfile.username}`
    : activePartner
    ? `${activePartner.slice(0, 6)}…${activePartner.slice(-6)}`
    : "";

  const activeMessages = activePartner
    ? messages.filter(
        (m) =>
          myWallet &&
          ((m.senderWallet === myWallet && m.recipientWallet === activePartner) ||
            (m.senderWallet === activePartner && m.recipientWallet === myWallet)),
      )
    : [];

  const handleSend = () => {
    if (!activePartner || !newMsgText.trim()) return;
    let proposal: DealProposalAttachment | undefined = undefined;
    if (showProposeCard) {
      proposal = {
        principal: propPrincipal,
        currency: "USDC",
        collateralBtc: (Number(propPrincipal) * 0.00005).toFixed(4),
        rateBps: propRate,
        months: propMonths,
        side: "lender",
        status: "proposed",
      };
    }
    sendMessage(activePartner, newMsgText.trim(), proposal);
    setNewMsgText("");
    setShowProposeCard(false);
  };

  const handleStartNewChat = () => {
    const trimmed = newPartnerInput.trim();
    if (!trimmed) return;
    const prof = getProfileByWalletOrUsername(trimmed);
    const resolvedWallet = prof ? prof.wallet : trimmed;
    setActivePartner(resolvedWallet);
    setShowNewChat(false);
    setNewPartnerInput("");
  };

  return (
    <AppFrame eyebrow="In-App Messaging" title="Deal Conversations">
      <div className="mt-8 grid h-[680px] gap-6 lg:grid-cols-[340px_1fr]">
        {/* Left Column: Conversations List */}
        <Card className="flex flex-col p-4">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <p className="eyebrow">Direct Threads</p>
            <Button
              variant="secondary"
              onClick={() => setShowNewChat(!showNewChat)}
              className="text-[11px] px-3 py-1"
            >
              + New Chat
            </Button>
          </div>

          {showNewChat && (
            <div className="my-3 space-y-2 border-b border-white/10 pb-3">
              <Input
                value={newPartnerInput}
                onChange={(e) => setNewPartnerInput(e.target.value)}
                placeholder="Enter handle @username or Solana address"
                className="text-xs"
              />
              <Button onClick={handleStartNewChat} className="w-full text-xs py-2">
                Start Chat
              </Button>
            </div>
          )}

          {/* Threads Scroll List */}
          <div className="mt-3 flex-1 space-y-1.5 overflow-y-auto pr-1">
            {conversationPartners.length === 0 ? (
              <div className="py-12 text-center text-xs font-mono text-white/40">
                No active message threads yet. Click &quot;+ New Chat&quot; or visit a profile to start a conversation.
              </div>
            ) : (
              conversationPartners.map((partner) => {
                const prof = getProfileByWalletOrUsername(partner);
                const handle = prof?.username ? `@${prof.username}` : `${partner.slice(0, 4)}…${partner.slice(-4)}`;
                const isSelected = activePartner === partner;
                const partnerLatest = messages
                  .filter(
                    (m) =>
                      myWallet &&
                      ((m.senderWallet === myWallet && m.recipientWallet === partner) ||
                        (m.senderWallet === partner && m.recipientWallet === myWallet)),
                  )
                  .pop();

                const unreadInThread = messages.filter(
                  (m) => m.senderWallet === partner && m.recipientWallet === myWallet && !m.read,
                ).length;

                return (
                  <button
                    key={partner}
                    type="button"
                    onClick={() => {
                      setActivePartner(partner);
                      if (myWallet) markAsRead(partner);
                    }}
                    className={`w-full text-left rounded-xl p-3 font-mono text-xs transition ${
                      isSelected
                        ? "border border-amber/50 bg-amber/15 text-white"
                        : "border border-white/5 bg-white/[0.02] text-white/70 hover:border-white/15 hover:bg-white/[0.04]"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-white">{handle}</span>
                      {unreadInThread > 0 && (
                        <span className="rounded-full bg-amber px-1.5 py-0.2 font-mono text-[9px] text-black font-bold">
                          {unreadInThread}
                        </span>
                      )}
                    </div>
                    {partnerLatest && (
                      <p className="mt-1 line-clamp-1 text-[11px] text-white/50">
                        {partnerLatest.text}
                      </p>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </Card>

        {/* Right Column: Active Conversation Workspace */}
        <Card className="flex flex-col p-6">
          {activePartner ? (
            <div className="flex h-full flex-col">
              {/* Partner Header */}
              <div className="flex items-center justify-between border-b border-white/10 pb-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-amber/30 to-orange/40 font-display-persat text-white">
                    {partnerTitle.replace("@", "").slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="font-display-persat text-lg uppercase text-white">{partnerTitle}</h3>
                    <p className="font-mono text-[11px] text-white/40">
                      Wallet: {activePartner.slice(0, 8)}…{activePartner.slice(-6)}
                    </p>
                  </div>
                </div>

                <a href={`/profile/${activePartner}`}>
                  <Button variant="secondary" className="text-xs px-3.5 py-1.5">
                    View Profile ↗
                  </Button>
                </a>
              </div>

              {/* Chat Messages Body */}
              <div className="flex-1 space-y-3.5 overflow-y-auto py-4 pr-2">
                {activeMessages.length === 0 ? (
                  <div className="py-20 text-center font-mono text-xs text-white/40">
                    This is the start of your direct conversation with {partnerTitle}. Discuss loan terms, negotiate rates, or attach a deal proposal.
                  </div>
                ) : (
                  activeMessages.map((msg) => {
                    const isMe = msg.senderWallet === myWallet;
                    return (
                      <div key={msg.id} className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}>
                        <div
                          className={`max-w-[80%] rounded-2xl p-4 text-xs leading-6 ${
                            isMe
                              ? "border border-amber/40 bg-gradient-to-r from-amber/25 to-amber/15 text-white"
                              : "border border-white/10 bg-white/[0.05] text-white/90"
                          }`}
                        >
                          <p className="font-semibold mb-1 text-[10px] text-amber">
                            {isMe ? "You" : `@${msg.senderHandle}`}
                          </p>
                          <p className="text-sm">{msg.text}</p>

                          {/* Embedded Structured Deal Card */}
                          {msg.dealProposal && (
                            <div className="mt-3 rounded-xl border border-white/20 bg-black/50 p-3.5 font-mono text-xs space-y-1">
                              <div className="flex justify-between font-semibold text-amber border-b border-white/10 pb-1.5 mb-2">
                                <span>PROPOSED DEAL TERMS</span>
                                <span className="uppercase text-[10px]">{msg.dealProposal.status}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-white/60">Principal:</span>
                                <span className="text-white font-semibold">
                                  {msg.dealProposal.principal} {msg.dealProposal.currency}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-white/60">Collateral:</span>
                                <span className="text-white font-semibold">
                                  {msg.dealProposal.collateralBtc} tBTC
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-white/60">Annual Rate:</span>
                                <span className="text-amber font-semibold">
                                  {Number(msg.dealProposal.rateBps) / 100}% APR
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-white/60">Duration:</span>
                                <span className="text-white">{msg.dealProposal.months} months</span>
                              </div>

                              {!isMe && msg.dealProposal.status === "proposed" && (
                                <div className="mt-3 flex gap-2 pt-2 border-t border-white/10">
                                  <Button
                                    className="flex-1 text-xs py-1.5"
                                    onClick={() => updateProposalStatus(msg.id, "accepted")}
                                  >
                                    Accept Terms
                                  </Button>
                                  <Button
                                    variant="danger"
                                    className="flex-1 text-xs py-1.5"
                                    onClick={() => updateProposalStatus(msg.id, "declined")}
                                  >
                                    Decline
                                  </Button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                        <span className="mt-1 font-mono text-[10px] text-white/30">
                          {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Proposal Attachment Builder */}
              {showProposeCard && (
                <div className="mb-3 rounded-xl border border-amber/40 bg-black/80 p-4 font-mono text-xs space-y-3 animate-reveal">
                  <div className="flex items-center justify-between text-amber font-semibold">
                    <span>Attach Loan Offer</span>
                    <button onClick={() => setShowProposeCard(false)} className="font-mono text-sm text-white/50 hover:text-amber" title="Dismiss">*</button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="text-[10px] text-white/50 block mb-1">Principal (USDC)</label>
                      <input
                        type="number"
                        value={propPrincipal}
                        onChange={(e) => setPropPrincipal(e.target.value)}
                        className="w-full rounded-lg border border-white/15 bg-white/[0.04] p-2 text-white outline-none focus:border-amber"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-white/50 block mb-1">Rate (bps, e.g. 820)</label>
                      <input
                        type="number"
                        value={propRate}
                        onChange={(e) => setPropRate(e.target.value)}
                        className="w-full rounded-lg border border-white/15 bg-white/[0.04] p-2 text-white outline-none focus:border-amber"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-white/50 block mb-1">Duration (mo)</label>
                      <input
                        type="number"
                        value={propMonths}
                        onChange={(e) => setPropMonths(Number(e.target.value))}
                        className="w-full rounded-lg border border-white/15 bg-white/[0.04] p-2 text-white outline-none focus:border-amber"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Chat Input Controls */}
              <div className="border-t border-white/10 pt-4 flex items-center gap-3">
                <Button
                  variant="secondary"
                  onClick={() => setShowProposeCard(!showProposeCard)}
                  className="px-3.5 py-2.5 text-xs shrink-0"
                >
                  ⚡ Attach Deal
                </Button>
                <Input
                  value={newMsgText}
                  onChange={(e) => setNewMsgText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSend();
                  }}
                  placeholder="Type message or negotiate terms with counterparty…"
                  className="flex-1"
                />
                <Button onClick={handleSend} className="px-6 py-2.5 text-xs shrink-0">
                  Send
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-center font-mono text-xs text-white/40">
              Select a conversation thread from the left or click &quot;+ New Chat&quot; to begin.
            </div>
          )}
        </Card>
      </div>
    </AppFrame>
  );
}
