import journal from "../drizzle/meta/_journal.json";
import m0000 from "../drizzle/0000_linear_sessions.sql";

export default {
  journal,
  migrations: {
    "0000_linear_sessions": m0000,
  },
};
