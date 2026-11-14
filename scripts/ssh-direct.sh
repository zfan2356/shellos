#!/usr/bin/env bash
# Deployment helpers may not inherit tunnels, agent forwarding or shared masters.
ssh() {
  command ssh -a -o ForwardAgent=no -o ClearAllForwardings=yes \
    -o ProxyCommand=none -o ProxyJump=none -o ControlMaster=no -o ControlPath=none "$@"
}
scp() {
  command scp -o ForwardAgent=no -o ClearAllForwardings=yes \
    -o ProxyCommand=none -o ProxyJump=none -o ControlMaster=no -o ControlPath=none "$@"
}
export GIT_SSH_COMMAND='ssh -a -o ForwardAgent=no -o ClearAllForwardings=yes -o ProxyCommand=none -o ProxyJump=none -o ControlMaster=no -o ControlPath=none'
