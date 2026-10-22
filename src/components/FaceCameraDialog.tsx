import { useEffect, useRef, useState } from "react";
import * as faceapi from "@vladmandic/face-api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { calculateFaceMatch, detectEyeBlink, loadFaceApiModels } from "@/lib/face-recognition";

type Mode = "enroll" | "verify";
type Completion = {
  descriptor: number[];
  score: number | null;
  livenessVerified: boolean;
  selfie: Blob;
};

export function FaceCameraDialog({
  open,
  onOpenChange,
  mode,
  storedDescriptor,
  onComplete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: Mode;
  storedDescriptor?: number[] | null;
  onComplete: (value: Completion) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const descriptorRef = useRef<number[] | null>(null);
  const matchRef = useRef<number | null>(null);
  const stableRef = useRef(0);
  const centersRef = useRef<Array<{ x: number; y: number }>>([]);
  const eyeWasOpenRef = useRef(false);
  const eyeWasClosedRef = useRef(false);
  const headBaselineRef = useRef<number | null>(null);
  const livenessRef = useRef(false);
  const [message, setMessage] = useState("جارٍ تجهيز الكاميرا والنماذج...");
  const [phase, setPhase] = useState<"loading" | "ready" | "blink" | "matched" | "mismatch" | "error">("loading");
  const [score, setScore] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    descriptorRef.current = null;
    matchRef.current = null;
    stableRef.current = 0;
    centersRef.current = [];
    eyeWasOpenRef.current = false;
    eyeWasClosedRef.current = false;
    headBaselineRef.current = null;
    livenessRef.current = false;
    setScore(null);
    setErrorMessage("");
    setPhase("loading");
    setMessage("جارٍ تجهيز الكاميرا والنماذج...");
    const stopCamera = () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
    const start = async () => {
      try {
        await loadFaceApiModels();
        if (cancelled) return;
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("المتصفح لا يدعم تشغيل الكاميرا");
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        setPhase("ready");
        setMessage("وجّه وجهك داخل الإطار وثبّته قليلاً");
        const analyze = async () => {
          if (cancelled || !videoRef.current || videoRef.current.readyState < 2) return;
          const currentVideo = videoRef.current;
          try {
            const result = await faceapi
              .detectSingleFace(currentVideo, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.55 }))
              .withFaceLandmarks(true)
              .withFaceDescriptor();
            if (!result) {
              stableRef.current = 0;
              descriptorRef.current = null;
              centersRef.current = [];
              setPhase("ready");
              setMessage("وجّه وجهك داخل الإطار");
            } else {
              const { x, y, width, height } = result.detection.box;
              const center = { x: x + width / 2, y: y + height / 2 };
              centersRef.current = [...centersRef.current.slice(-3), center];
              const stable = centersRef.current.length >= 3 && centersRef.current.every((point) =>
                Math.hypot(point.x - center.x, point.y - center.y) < Math.max(width, height) * 0.09,
              );
              const canvas = document.createElement("canvas");
              canvas.width = currentVideo.videoWidth;
              canvas.height = currentVideo.videoHeight;
              const context = canvas.getContext("2d", { willReadFrequently: true });
              context?.drawImage(currentVideo, 0, 0, canvas.width, canvas.height);
              const pixels = context?.getImageData(0, 0, canvas.width, canvas.height).data;
              let brightness = 0;
              let samples = 0;
              if (pixels) {
                const step = Math.max(4, Math.floor(pixels.length / 12000 / 4) * 4);
                for (let index = 0; index < pixels.length; index += step) {
                  brightness += pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114;
                  samples++;
                }
              }
              const clearLight = samples > 0 && brightness / samples > 35;
              stableRef.current = stable && clearLight ? stableRef.current + 1 : 0;
              descriptorRef.current = Array.from(result.descriptor);
              if (mode === "verify" && storedDescriptor?.length === 128) {
                const match = calculateFaceMatch(result.descriptor, storedDescriptor);
                matchRef.current = match.score;
                setScore(match.score);
                if (match.score < 75) {
                  setPhase("mismatch");
                  setMessage("الوجه غير متطابق مع هوية الموظف، يرجى المحاولة مرة أخرى");
                } else if (stableRef.current >= 3 && !livenessRef.current) {
                  const blink = detectEyeBlink(result.landmarks);
                  const leftEye = result.landmarks.getLeftEye();
                  const rightEye = result.landmarks.getRightEye();
                  const eyeMid = (leftEye[0].x + rightEye[3].x) / 2;
                  const eyeWidth = Math.max(1, rightEye[3].x - leftEye[0].x);
                  const nose = result.landmarks.getNose();
                  const headAngle = (nose[3].x - eyeMid) / eyeWidth;
                  if (headBaselineRef.current == null) headBaselineRef.current = headAngle;
                  if (blink) eyeWasClosedRef.current = true;
                  if (!blink && eyeWasClosedRef.current && eyeWasOpenRef.current) livenessRef.current = true;
                  if (!blink) eyeWasOpenRef.current = true;
                  if (Math.abs(headAngle - headBaselineRef.current) > 0.2) livenessRef.current = true;
                  setPhase(livenessRef.current ? "matched" : "blink");
                  setMessage(livenessRef.current
                    ? "تم التحقق من الحيوية ومطابقة الهوية بنجاح!"
                    : "تم كشف الوجه.. يُرجى الرمش بعينك أو تحريك رأسك للتحقق من الحيوية");
                } else if (livenessRef.current) {
                  setPhase("matched");
                  setMessage("تم التحقق من الحيوية ومطابقة الهوية بنجاح!");
                }
              } else if (stableRef.current >= 3) {
                setPhase("ready");
                setMessage("وجه واضح وثابت. اضغط تسجيل البصمة لحفظها");
              } else {
                setPhase("ready");
                setMessage(clearLight ? "ثبّت وجهك داخل الإطار" : "الإضاءة ضعيفة؛ انتقل إلى مكان أوضح");
              }
            }
          } catch {
            setPhase("error");
            setErrorMessage("تعذر تحليل الوجه. تأكد من وضوح الإضاءة ثم أعد المحاولة.");
          }
          if (!cancelled) timerRef.current = window.setTimeout(() => void analyze(), 180);
        };
        void analyze();
      } catch (error) {
        if (cancelled) return;
        setPhase("error");
        const name = error instanceof Error ? error.name : "";
        setErrorMessage(name === "NotAllowedError" || name === "PermissionDeniedError"
          ? "يُرجى السماح باستخدام الكاميرا من إعدادات المتصفح ثم المحاولة مجدداً."
          : error instanceof Error && error.message.includes("الكاميرا")
            ? error.message
            : "تعذر تحميل نماذج التحقق أو تشغيل الكاميرا. اتصل بالإنترنت أول مرة ثم أعد المحاولة.");
      }
    };
    void start();
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [open, mode, storedDescriptor]);

  const finish = () => {
    const video = videoRef.current;
    const descriptor = descriptorRef.current;
    if (!video || !descriptor) return;
    if (mode === "verify" && (matchRef.current == null || matchRef.current < 75 || !livenessRef.current)) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const context = canvas.getContext("2d");
    if (!context) return setErrorMessage("تعذر تجهيز صورة التحقق");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((selfie) => {
      if (!selfie) return setErrorMessage("تعذر التقاط صورة التحقق");
      onComplete({ descriptor, score: mode === "verify" ? score : null, livenessVerified: mode === "verify" && livenessRef.current, selfie });
      onOpenChange(false);
    }, "image/jpeg", 0.82);
  };

  const matched = mode === "verify" && phase === "matched" && score != null && score >= 75 && livenessRef.current;
  const tone = phase === "matched" ? "border-emerald-400" : phase === "mismatch" || phase === "error" ? "border-rose-500" : phase === "blink" ? "border-amber-400" : "border-slate-400";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>{mode === "enroll" ? "تسجيل بصمة الوجه" : "التحقق من الوجه والحيوية"}</DialogTitle></DialogHeader>
        <div className="space-y-4 text-center">
          <div className={`relative mx-auto aspect-[4/3] w-full max-w-md overflow-hidden rounded-2xl border-4 bg-slate-950 ${tone}`}>
            <video ref={videoRef} muted playsInline autoPlay className="h-full w-full object-cover" />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className={`h-[78%] w-[58%] rounded-[50%] border-[3px] border-dashed ${phase === "matched" ? "border-emerald-400" : phase === "mismatch" || phase === "error" ? "border-rose-500" : phase === "blink" ? "border-amber-400" : "border-white/70"}`} />
            </div>
            {phase === "matched" && <div className="absolute bottom-3 left-3 rounded-full bg-emerald-600 px-3 py-1 text-sm font-semibold text-white">{Math.round(score ?? 0)}%</div>}
          </div>
          <p role="status" className={`text-sm font-medium ${phase === "matched" ? "text-emerald-700" : phase === "mismatch" || phase === "error" ? "text-rose-700" : phase === "blink" ? "text-amber-700" : "text-muted-foreground"}`}>
            {phase === "error" ? errorMessage || message : message}
          </p>
          {mode === "verify" && phase === "mismatch" && <Button variant="outline" onClick={() => { setPhase("ready"); setScore(null); setMessage("وجّه وجهك داخل الإطار"); }}>إعادة المحاولة</Button>}
          <Button onClick={finish} disabled={phase === "loading" || phase === "error" || (mode === "enroll" ? stableRef.current < 3 : !matched)} className="w-full">
            {mode === "enroll" ? "تسجيل البصمة" : matched ? "تأكيد الحضور مع التحقق" : "أكمل فحص الحيوية والمطابقة"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
