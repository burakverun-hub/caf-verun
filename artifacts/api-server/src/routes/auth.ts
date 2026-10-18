import { Router, type IRouter } from "express";
import { GetAuthMeResponse } from "@workspace/api-zod";
import { getCafeUser, requireCafeUser, userProfile } from "../middlewares/cafeAuth";

const router: IRouter = Router();

router.get("/auth/me", requireCafeUser(), async (_req, res): Promise<void> => {
  res.json(GetAuthMeResponse.parse(await userProfile(getCafeUser(res))));
});

export default router;
