export const startOidcLogin = () => {
  window.location.assign("/auth/login");
};

export const logoutOidc = async () => {
  const response = await fetch("/auth/logout", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
  });
  if (!response.ok && response.status !== 204) {
    throw new Error("Logout failed");
  }
};
