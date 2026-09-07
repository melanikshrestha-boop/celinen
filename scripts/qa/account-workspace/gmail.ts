export const useGmail = () => ({
  configured: false,
  ready: true,
  status: { state: "disconnected", note: "" },
  connect() {
    throw new Error("External connection not allowed in fixture");
  },
  disconnect: async () => {},
});
