const particleMotionQuery = window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;
const particlePointerQuery = window.matchMedia
    ? window.matchMedia("(hover: hover) and (pointer: fine)")
    : null;
const enableParticleMouseFollow = (
    (!particleMotionQuery || !particleMotionQuery.matches) &&
    (!particlePointerQuery || particlePointerQuery.matches)
);

if (window.particlesJS) {
particlesJS("particles-js", {
    particles: {
        number: {
            value: 110,
            density: {
                enable: true,
                value_area: 900
            }
        },
        color: {
            value: "#60a5fa"
        },
        shape: {
            type: "circle"
        },
        opacity: {
            value: 0.42,
            random: true
        },
        size: {
            value: 3,
            random: true
        },
        line_linked: {
            enable: true,
            distance: 150,
            color: "#38bdf8",
            opacity: 0.25,
            width: 1
        },
        move: {
            enable: true,
            speed: 1.3,
            direction: "none",
            random: true,
            straight: false,
            out_mode: "out"
        }
    },
    interactivity: {
        detect_on: "window",
        events: {
            onhover: {
                enable: enableParticleMouseFollow,
                mode: ["grab", "bubble"]
            },
            onclick: {
                enable: true,
                mode: "push"
            },
            resize: true
        },
        modes: {
            grab: {
                distance: 175,
                line_linked: {
                    opacity: 0.5
                }
            },
            push: {
                particles_nb: 3
            },
            bubble: {
                distance: 165,
                size: 3.6,
                duration: 1.2,
                opacity: 0.55,
                speed: 2
            }
        }
    },
    retina_detect: true
});
}

const promptButtons = document.querySelectorAll(".quick-prompts button");
const questionInput = document.getElementById("questionInput");
const submitBtn = document.getElementById("submitBtn");
const chatForm = document.querySelector(".chat-form");

promptButtons.forEach(button => {
    button.addEventListener("click", () => {
        questionInput.value = button.CDATA_SECTION_NODE.question;
        questionInput.focus();
    });
});

if (chatForm) {
    chatForm.addEventListener("submit", () => {
        if (!questionInput.value.trim()) return;

        const loadingMessage = document.getElementById("loadingMessage");
        const emptyChat = document.querySelector(".empty-chat");
        const chatWindow = document.querySelector(".chat-window");

        submitBtn.innerHTML = '<span class="button-spinner"></span>Generating...';
        submitBtn.disabled = true;
        questionInput.readOnly = true;

        if (emptyChat) {
            emptyChat.classList.add("hide");
        }

        if (loadingMessage) {
            loadingMessage.classList.add("show");
        }

        if (chatWindow) {
            setTimeout(() => {
                chatWindow.scrollTo({
                    top: chatWindow.scrollHeight,
                    behavior: "smooth"
                });
            }, 80);
        }
    });
}

/* Scroll reveal animation: replay every time */

const revealItems = document.querySelectorAll(".reveal-item");

const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add("show");
        } else {
            entry.target.classList.remove("show");
        }
    });
}, {
    threshold: 0.16,
    rootMargin: "0px 0px -8% 0px"
});

revealItems.forEach(item => {
    revealObserver.observe(item);
});


/* Animated stats counter */

const statNumbers = document.querySelectorAll(".stat-number");
let statsStarted = false;

function animateNumber(element) {
    const target = Number(element.dataset.target);
    let current = 0;
    const duration = 1200;
    const steps = 45;
    const increment = target / steps;
    const intervalTime = duration / steps;

    const counter = setInterval(() => {
        current += increment;

        if (current >= target) {
            element.textContent = target;
            clearInterval(counter);
        } else {
            element.textContent = Math.floor(current);
        }
    }, intervalTime);
}

const statsObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting && !statsStarted) {
            statsStarted = true;
            statNumbers.forEach(number => animateNumber(number));
            statsObserver.disconnect();
        }
    });
}, {
    threshold: 0.4
});

const featureBar = document.querySelector(".feature-bar");

if (featureBar) {
    statsObserver.observe(featureBar);
}

/* Final scroll-controlled central 3D brain showcase */

const brainShowcaseModelFinal = document.getElementById("brainShowcaseModel");
const brainShowcaseSectionFinal = document.getElementById("brain-showcase");

let brainShowcaseTickingFinal = false;

function updateBrainShowcaseFinal() {
    if (!brainShowcaseModelFinal || !brainShowcaseSectionFinal) return;

    const rect = brainShowcaseSectionFinal.getBoundingClientRect();
    const windowHeight = window.innerHeight;

    let progress = (windowHeight - rect.top) / (rect.height + windowHeight);
    progress = Math.max(0, Math.min(1, progress));

    const orbitAngle = -30 + progress * 120;
    const verticalAngle = 72;
    const distance = 3.05;

    brainShowcaseModelFinal.setAttribute(
        "camera-orbit",
        `${orbitAngle}deg ${verticalAngle}deg ${distance}m`
    );

    brainShowcaseModelFinal.setAttribute(
        "camera-target",
        "0m 0m 0m"
    );

    const textY = (0.5 - progress) * 45;
    const leftX = -12 + progress * 10;
    const rightX = 12 - progress * 10;

    brainShowcaseSectionFinal.style.setProperty("--showcase-text-y", `${textY}px`);
    brainShowcaseSectionFinal.style.setProperty("--showcase-left-x", `${leftX}px`);
    brainShowcaseSectionFinal.style.setProperty("--showcase-right-x", `${rightX}px`);
    brainShowcaseSectionFinal.style.setProperty("--showcase-text-opacity", "1");

    brainShowcaseSectionFinal.style.setProperty("--showcase-text-y", `${textY}px`);
    brainShowcaseSectionFinal.style.setProperty("--showcase-left-x", `${leftX}px`);
    brainShowcaseSectionFinal.style.setProperty("--showcase-right-x", `${rightX}px`);
    brainShowcaseSectionFinal.style.setProperty("--showcase-text-opacity", "1");

const showcaseLeft = document.querySelector(".showcase-left");
const showcaseRight = document.querySelector(".showcase-right");

if (progress > 0.08 && progress < 0.92) {
    showcaseLeft?.classList.add("show");
    showcaseRight?.classList.add("show");
} else {
    showcaseLeft?.classList.remove("show");
    showcaseRight?.classList.remove("show");
}

brainShowcaseTickingFinal = false;

    brainShowcaseTickingFinal = false;
}

function requestBrainShowcaseUpdateFinal() {
    if (!brainShowcaseTickingFinal) {
        window.requestAnimationFrame(updateBrainShowcaseFinal);
        brainShowcaseTickingFinal = true;
    }
}

window.addEventListener("scroll", requestBrainShowcaseUpdateFinal, { passive: true });
window.addEventListener("resize", requestBrainShowcaseUpdateFinal);

updateBrainShowcaseFinal();
