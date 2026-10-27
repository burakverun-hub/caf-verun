import {
  decodeProtectedHeader,
  importX509,
  jwtVerify,
  type JWTPayload,
} from "jose";

const FIREBASE_CERTS_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID?.trim();

type CertificateSet = Record<string, string>;
type CachedCertificateSet = {
  certificates: CertificateSet;
  expiresAt: number;
};

export type FirebaseIdentity = {
  uid: string;
  email: string;
  name: string | null;
};

export class FirebaseTokenError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "FirebaseTokenError";
  }
}

let certificateCache: CachedCertificateSet | null = null;
let certificateFetch: Promise<CertificateSet> | null = null;
const signingKeys = new Map<string, Promise<Awaited<ReturnType<typeof importX509>>>>();

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function loadCertificates(forceRefresh = false): Promise<CertificateSet> {
  if (!forceRefresh && certificateCache && certificateCache.expiresAt > Date.now()) {
    return certificateCache.certificates;
  }
  if (certificateFetch) return certificateFetch;

  certificateFetch = (async () => {
    let response: Response;
    try {
      response = await fetch(FIREBASE_CERTS_URL, {
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw new FirebaseTokenError(
        503,
        "Firebase kimlik doğrulama anahtarlarına ulaşılamıyor.",
      );
    }
    if (!response.ok) {
      throw new FirebaseTokenError(
        503,
        "Firebase kimlik doğrulama anahtarları alınamadı.",
      );
    }

    let certificates: unknown;
    try {
      certificates = await response.json();
    } catch {
      throw new FirebaseTokenError(
        503,
        "Firebase kimlik doğrulama anahtarları okunamadı.",
      );
    }
    if (!isObject(certificates) || !Object.values(certificates).every((value) => typeof value === "string")) {
      throw new FirebaseTokenError(
        503,
        "Firebase kimlik doğrulama anahtarlarının biçimi geçersiz.",
      );
    }

    const maxAge = response.headers
      .get("cache-control")
      ?.match(/max-age=(\d+)/i)?.[1];
    const cacheDurationMs = maxAge ? Number(maxAge) * 1000 : 5 * 60 * 1000;
    certificateCache = {
      certificates: certificates as CertificateSet,
      expiresAt: Date.now() + cacheDurationMs,
    };
    return certificateCache.certificates;
  })();

  try {
    return await certificateFetch;
  } finally {
    certificateFetch = null;
  }
}

async function getSigningKey(kid: string) {
  let certificates = await loadCertificates();
  if (!certificates[kid]) {
    certificates = await loadCertificates(true);
  }
  const certificate = certificates[kid];
  if (!certificate) {
    throw new FirebaseTokenError(401, "Kimlik doğrulama belirteci geçersiz.");
  }

  let signingKey = signingKeys.get(kid);
  if (!signingKey) {
    signingKey = importX509(certificate, "RS256");
    signingKeys.set(kid, signingKey);
  }
  try {
    return await signingKey;
  } catch {
    signingKeys.delete(kid);
    throw new FirebaseTokenError(401, "Kimlik doğrulama belirteci geçersiz.");
  }
}

export async function verifyFirebaseIdToken(token: string): Promise<FirebaseIdentity> {
  if (!FIREBASE_PROJECT_ID) {
    throw new FirebaseTokenError(
      503,
      "Firebase proje kimliği sunucu ortamında ayarlanmamış.",
    );
  }

  let header: ReturnType<typeof decodeProtectedHeader>;
  try {
    header = decodeProtectedHeader(token);
  } catch {
    throw new FirebaseTokenError(401, "Kimlik doğrulama belirteci geçersiz.");
  }
  if (header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid) {
    throw new FirebaseTokenError(401, "Kimlik doğrulama belirteci geçersiz.");
  }

  const signingKey = await getSigningKey(header.kid);
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, signingKey, {
      algorithms: ["RS256"],
      audience: FIREBASE_PROJECT_ID,
      issuer: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
      clockTolerance: 60,
    }));
  } catch {
    throw new FirebaseTokenError(401, "Oturum geçersiz veya süresi dolmuş.");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (
    typeof payload.sub !== "string" ||
    !payload.sub ||
    typeof payload.exp !== "number" ||
    payload.exp <= nowSeconds ||
    typeof payload.iat !== "number" ||
    payload.iat > nowSeconds ||
    typeof payload.auth_time !== "number" ||
    payload.auth_time > nowSeconds
  ) {
    throw new FirebaseTokenError(401, "Kimlik doğrulama belirteci geçersiz.");
  }

  const firebaseClaims = isObject(payload.firebase) ? payload.firebase : {};
  if (firebaseClaims.sign_in_provider === "anonymous") {
    throw new FirebaseTokenError(401, "Anonim oturumlar desteklenmiyor.");
  }
  if (payload.email_verified !== true) {
    throw new FirebaseTokenError(
      403,
      "Devam etmek için e-posta adresinizi doğrulayın.",
    );
  }
  if (typeof payload.email !== "string" || !payload.email.trim()) {
    throw new FirebaseTokenError(
      403,
      "Hesabınızda doğrulanmış bir e-posta bulunamadı.",
    );
  }

  return {
    uid: payload.sub,
    email: payload.email.trim().toLowerCase(),
    name: typeof payload.name === "string" && payload.name.trim()
      ? payload.name.trim()
      : null,
  };
}
