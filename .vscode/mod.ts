import {
  Application,
  Router,
  helpers,
  NativeRequest,
} from "https://deno.land/x/oak@v12.4.0/mod.ts";
import { multiParser } from "https://deno.land/x/multiparser@0.114.0/mod.ts";
import Minio from "npm:minio";

const minioClient = new Minio.Client({
  endPoint: "192.168.50.2",
  port: 9000,
  useSSL: false,
});

import { fetchLoops } from "./db.ts";

const router = new Router();

router.get("/", (ctx) => {
  ctx.response.redirect("https://floopr.org");
});
router.get("/latest", (ctx) => {
  ctx.response.body = "v1";
});

router.get("/v1/loops", async (ctx) => {
  const query = helpers.getQuery(ctx);
  const limit = parseInt(query.limit || "16");
  const skip = parseInt(query.page) * limit || 0;
  const loops = await fetchLoops(skip, limit);
  ctx.response.body = loops;
});
router.post("/v1/upload", async (ctx) => {
  const form = await multiParser(
    (ctx.request.originalRequest as NativeRequest).request
  );
  if (!form) {
    ctx.response.body =
      "We couldn't parse your form. Please try something else.";
    return;
  }
  if (!form.files) {
    ctx.response.body = "We couldn't find any files in your form";
    return;
  }
  //@ts-ignore: Deno doesn't know about the audio property
  if (form.files.audio.length > 36000) {
    ctx.response.body =
      "Your audio file is too short. Please try something longer.";
    return;
  }
  const file = form.files.audio;
  const metaData = {
    //@ts-expect-error: Deno doesn't know about the contentType property
    "Content-Type": file.contentType,
  };
  await minioClient.putObject("submissions", "a.mp3", file.content, metaData);

  ctx.response.body =
    "Thank you for your submission! Our team will review it and add it to the site shortly.";
});

const app = new Application();

app.use(router.routes());
app.use(router.allowedMethods());

await app.listen({ port: 3001 });
